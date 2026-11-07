import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { browserDebugOrigin, browserDebugEditorPatch } from '../../apps/production-extension/browser-debug-ui.js';
import { MANAGEMENT_SECTIONS, MANAGEMENT_TABS, managementSectionForHash, managementHashForSection } from '../../apps/production-extension/management-ui.js';
import { BROWSER_DEBUG_KEYS, BROWSER_DEBUG_MESSAGES } from '../production-locales-browser-debug.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

test('Browser Debug retains its canonical deep link while Settings owns its place outside the visible tabs', () => {
  assert.deepEqual(MANAGEMENT_SECTIONS, ['hub', 'detector', 'api', 'firewall', 'antidetect', 'autosurf', 'cookies', 'proxy', 'integrations', 'settings', 'contacts', 'browser-debug']);
  assert.deepEqual(MANAGEMENT_TABS, ['hub', 'detector', 'api', 'firewall', 'antidetect', 'autosurf', 'cookies', 'proxy', 'integrations', 'settings', 'contacts']);
  assert.equal(Object.isFrozen(MANAGEMENT_TABS), true);
  assert.equal(managementSectionForHash('#browser-debug'), 'browser-debug'); assert.equal(managementHashForSection('browser-debug'), '#browser-debug');
  assert.equal(managementSectionForHash('#protection'), 'api'); assert.equal(managementSectionForHash('#history'), 'firewall');
});
test('editor preserves false and typed selections, rejects invalid URLs/types and exact-origin scope expansion', () => {
  const fields = [{ key: 'enabled', type: 'boolean', required: true }, { key: 'value', type: 'select', options: ['allow', 'block'] }, { key: 'url', type: 'url', required: true }];
  assert.deepEqual(browserDebugEditorPatch(fields, { enabled: false, value: 'block', url: 'https://example.test/' }), { enabled: false, value: 'block', url: 'https://example.test/' });
  for (const patch of [{ enabled: 'false', value: 'block', url: 'https://example.test/' }, { enabled: true, value: 'invented', url: 'https://example.test/' }, { enabled: true, value: 'block', url: 'javascript:alert(1)' }, { enabled: true, value: 'block', url: 'https://user:secret@example.test/' }]) assert.equal(browserDebugEditorPatch(fields, patch), null);
  assert.equal(browserDebugOrigin('https://example.test:8443'), 'https://example.test:8443');
  for (const input of ['https://example.test/other', 'https://example.test/?private=token', 'https://example.test/#private', 'https://user:secret@example.test/', 'file:///private', '*://*.example.test/*']) assert.equal(browserDebugOrigin(input), null);
});
test('all 21 shipped catalogs contain every Browser Debug label/action/error without fallback to raw keys', () => {
  assert.equal(new Set(BROWSER_DEBUG_KEYS).size, 108);
  for (const language of PRODUCTION_LANGUAGES) {
    const directory = language.uiOnly ? 'ui-locales' : '_locales';
    const table = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + directory + '/' + language.id + '/messages.json', import.meta.url)));
    for (const key of BROWSER_DEBUG_KEYS) {
      assert.equal(typeof BROWSER_DEBUG_MESSAGES[language.id][key], 'string', language.id + ':' + key);
      assert.ok(BROWSER_DEBUG_MESSAGES[language.id][key].trim()); assert.equal(table[key].message, BROWSER_DEBUG_MESSAGES[language.id][key]);
    }
    assert.equal(table.management_tab_browser_debug.message, 'Browser Debug');
  }
});
