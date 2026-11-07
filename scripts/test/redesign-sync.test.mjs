// ADR-103: the redesign sync keeps both Inspector bundles renderable and idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchInspector } from '../production/sync-redesign-ui.mjs';

const directory = resolve(import.meta.dirname, '../../apps/production-extension');
const read = name => readFileSync(resolve(directory, name), 'utf8');
const inspector = source => { const start = source.indexOf('function InspectorView('); return source.slice(start, source.indexOf('\n// packages/', start)); };
const freeEmbedded = /(?<![\w.$-])embedded(?!\s*:)(?![\w$])/;

test('ADR-103: the synchronized popup and side panel bundles are already up to date', () => {
  for (const name of ['popup.js', 'sidepanel.js']) assert.equal(patchInspector(name, read(name)), read(name), name);
});

test('ADR-103: only the popup InspectorView reads embedded; the side panel gets the fixed non-embedded form', () => {
  const popup = inspector(read('popup.js')), sidepanel = inspector(read('sidepanel.js'));
  assert.match(popup, /^function InspectorView\(\{ session, surface, embedded = false \}\)/);
  assert.ok(popup.includes('tabId: session.tabId, embedded }),') && popup.includes('embedded ? null : u3(BrandLinks, {})'));
  assert.match(sidepanel, /^function InspectorView\(\{ session, surface \}\)/);
  assert.equal(freeEmbedded.test(sidepanel), false, 'side panel InspectorView has no undeclared embedded read');
  assert.ok(sidepanel.includes('tabId: session.tabId, embedded: false }),') && sidepanel.includes('\n    u3(BrandLinks, {})\n  ] });'));
});

test('ADR-103: a side panel bundle patched with the popup-only form is migrated, and a free read is rejected', () => {
  const current = read('sidepanel.js');
  const broken = current.replace('tabId: session.tabId, embedded: false }),', 'tabId: session.tabId, embedded }),').replace('\n    u3(BrandLinks, {})\n  ] });', '\n    embedded ? null : u3(BrandLinks, {})\n  ] });');
  assert.notEqual(broken, current);
  assert.equal(patchInspector('sidepanel.js', broken), current);
  const view = current.indexOf('function InspectorView(');
  const free = current.slice(0, view) + current.slice(view).replace('u3("main", { class: "app inspector', 'u3("main", { "data-embedded": embedded, class: "app inspector');
  assert.throws(() => patchInspector('sidepanel.js', free), /reads embedded without declaring it/);
});
