// ADR-047 (S1): the module «Защита» files in apps/production-extension are exactly the recorded build of the vendored
// 722fae8 sources (BUILD.json, VENDOR.json), pass the 722fae8 bundle gates, carry the owner's hook decision, and
// protect-sw.js answers only the module's message types. Cheap: no esbuild run (build-protect.mjs --check rebuilds).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { auditBundle, preactPrefix, LINT_INVENTORY } from '../build-protect.mjs';
import {
  OBSERVATION_BUNDLES,
  OBSERVATION_FORBIDDEN_STRINGS,
  PROTECT_BUILD_RECORD,
  PROTECT_BUNDLES,
  PROTECT_CATALOG_FILE,
  PROTECT_CHROME_ONLY,
  PROTECT_FIREFOX_STUBS,
  PROTECT_OUTPUTS,
} from '../protect-files.mjs';
import { VENDOR_COMMIT, VENDOR_MANIFEST, checkVendor } from '../vendor-protect.mjs';

const root = resolve(import.meta.dirname, '../../..');
const ext = join(root, 'apps/production-extension');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('vendor/protect-722fae8 is the byte copy recorded in VENDOR.json', () => {
  const result = checkVendor();
  assert.deepEqual(result.problems, []);
  assert.ok(result.files > 600, 'vendored file count ' + result.files);
});

test('module files match BUILD.json (commit, VENDOR.json hash, sha256 of every output)', () => {
  const record = readJson(join(root, PROTECT_BUILD_RECORD));
  assert.equal(record.commit, VENDOR_COMMIT);
  assert.equal(record.vendorManifestSha256, sha256(readFileSync(join(root, VENDOR_MANIFEST))));
  assert.deepEqual(Object.keys(record.outputs).sort(), [...PROTECT_OUTPUTS]);
  for (const name of PROTECT_OUTPUTS) {
    const bytes = readFileSync(join(ext, name));
    assert.equal(sha256(bytes), record.outputs[name].sha256, name);
    assert.equal(bytes.length, record.outputs[name].bytes, name);
  }
  assert.equal(sha256(readFileSync(join(root, PROTECT_CATALOG_FILE))), record.catalog.sha256);
  assert.match(record.hookConfig, /send wrap/);
});

test('every bundle passes the 722fae8 gates (IIFE, MAIN without chrome.*, preludes, relay, hook table, scanCode)', () => {
  for (const bundle of PROTECT_BUNDLES) {
    const text = readFileSync(join(ext, bundle.out), 'utf8');
    assert.deepEqual(auditBundle(bundle, text), [], bundle.out);
  }
  const ui = readFileSync(join(ext, 'protect-ui.js'), 'utf8');
  const prefix = preactPrefix(ui);
  assert.deepEqual(prefix.problems, []);
  assert.equal(readJson(join(root, LINT_INVENTORY)).preact['apps/production-extension/protect-ui.js'], prefix.sha256);
});

test('owner decision: send hooks wrap (script attribution), listen off, observe wrap, imgSrc off', () => {
  for (const name of ['protect.main.js', 'protect-sw.js']) {
    const text = readFileSync(join(ext, name), 'utf8');
    assert.match(text, /PROTECT_HOOK_DECISION = Object\.freeze\(\{\s*status: "decided",\s*decidedAt: "2026-10-18",\s*archive: null,\s*listen: "off",\s*send: "wrap",\s*observe: "wrap",\s*imgSrc: "off"\s*\}\)/, name);
    assert.ok(!text.includes('protect-hooks-spike-strong'), name + ' still carries the vendored release decision');
  }
});

test('observation bundles carry no module string; the file lists are consistent', () => {
  for (const name of OBSERVATION_BUNDLES) {
    const text = readFileSync(join(ext, name), 'utf8');
    for (const marker of OBSERVATION_FORBIDDEN_STRINGS) assert.ok(!text.includes(marker), name + ' contains ' + marker);
  }
  assert.deepEqual([...PROTECT_CHROME_ONLY, ...Object.keys(PROTECT_FIREFOX_STUBS)].sort(), [...PROTECT_OUTPUTS]);
  for (const name of PROTECT_OUTPUTS) assert.ok(existsSync(join(ext, name)), name);
});

test('module catalog: ru/en parity, production keys separate, consent text unchanged (digest of 722fae8)', async () => {
  const catalog = readJson(join(root, PROTECT_CATALOG_FILE));
  const own = readJson(join(root, 'apps/production-protect/src/locales/ru.json'));
  const vendorRu = readJson(join(root, 'vendor/protect-722fae8/apps/extension/_locales/ru/messages.json'));
  assert.deepEqual(Object.keys(catalog.ru), Object.keys(catalog.en));
  for (const key of Object.keys(own)) assert.ok(!Object.hasOwn(vendorRu, key), 'production key collides: ' + key);
  const holders = (entry) => JSON.stringify(Object.keys(entry.placeholders ?? {}).sort());
  for (const key of Object.keys(catalog.ru)) assert.equal(holders(catalog.ru[key]), holders(catalog.en[key]), key);
  const consent = await build({ entryPoints: [join(root, 'vendor/protect-722fae8/packages/engine/src/protect/consent.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(consent.outputFiles[0].text).toString('base64'));
  const input = mod.PROTECT_CONSENT_KEYS.map((key) => catalog.ru[key].message + '\n' + catalog.en[key].message).join('\n');
  assert.equal(sha256(Buffer.from(input, 'utf8')), mod.PROTECT_CONSENT_DIGEST.sha256);
  for (const key of ['badge_tooltip_firewall', 'tab_protect', 'tab_history', 'protect_title', 'protect_page_title', 'protect_locale_fallback_note']) assert.ok(Object.hasOwn(catalog.ru, key), key);
});

/** Minimal chrome stub: events record listeners; storage and scripting answer empty. */
function chromeStub() {
  const events = {};
  const event = (name) => (events[name] = { listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener() {}, hasListener: () => false });
  const area = () => ({ get: async () => ({}), set: async () => undefined, remove: async () => undefined, getBytesInUse: async () => 0, onChanged: event('area') });
  const actionCalls = [];
  const record = (name) => async (...args) => void actionCalls.push([name, ...args]);
  return {
    events,
    actionCalls,
    chrome: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', onMessage: event('onMessage'), getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p, sendMessage: async () => undefined },
      webNavigation: { onCommitted: event('onCommitted') },
      tabs: { onRemoved: event('onRemoved'), onReplaced: event('onReplaced'), onActivated: event('onActivated'), sendMessage: async () => undefined, query: async () => [] },
      windows: { onFocusChanged: event('onFocusChanged'), onRemoved: event('onWindowRemoved') },
      permissions: { onAdded: event('onAdded'), onRemoved: event('onRemoved2'), contains: async () => true },
      storage: { local: area(), session: area(), managed: { get: async () => ({}), onChanged: event('managed') }, onChanged: event('storage') },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined, updateContentScripts: async () => undefined },
      webRequest: { onBeforeRequest: event('wr1'), onSendHeaders: event('wr2'), onErrorOccurred: event('wr3'), onCompleted: event('wr4') },
      action: { setBadgeText: async () => undefined, setPopup: record('setPopup'), getPopup: record('getPopup'), openPopup: record('openPopup') },
      i18n: { getUILanguage: () => 'ru', getMessage: () => '' },
    },
  };
}

test('protect-sw.js: top-level listeners; answers only the 26 module types, nothing else', async () => {
  const stub = chromeStub();
  globalThis.chrome = stub.chrome;
  try {
    const mod = await import(pathToFileURL(join(ext, 'protect-sw.js')).href + '?test=' + Date.now());
    for (const name of ['onMessage', 'onCommitted', 'onRemoved', 'onReplaced', 'onActivated', 'onFocusChanged', 'onWindowRemoved', 'onAdded', 'onRemoved2', 'managed']) assert.equal(stub.events[name].listeners.length, 1, name);
    const owned = ['protect-hello', 'protect-arm', 'protect-input', 'protect-events', 'ui-protect-get-state', 'ui-protect-enable', 'ui-protect-request-delete'];
    const foreign = ['sensor-events', 'ui-get-report', 'ui-protection-get', 'ui-protection-set', 'protection-query', 'protect-ack', 'protect-control', 'ui-protect-', 'UI-PROTECT-GET-STATE', ''];
    for (const type of owned) assert.equal(mod.protectHost.owns({ type }), true, type);
    for (const type of foreign) assert.equal(mod.protectHost.owns({ type }), false, type);
    assert.equal(mod.protectHost.owns(null), false);
    assert.equal(mod.protectHost.owns('ui-protect-get-state'), false);
    assert.equal(mod.protectHost.owns(Object.create({ type: 'protect-hello' })), false, 'inherited type is not own data');
    const listener = stub.events.onMessage.listeners[0];
    let answered = 0;
    for (const type of foreign) assert.equal(listener({ schemaVersion: 1, type }, { id: stub.chrome.runtime.id }, () => answered++), false, type);
    assert.equal(answered, 0, 'foreign messages never get a module answer');
    // A page sender cannot reach ui-protect-*; the module answers (true) with unauthorized-sender.
    const page = { id: stub.chrome.runtime.id, origin: 'https://example.com', url: 'https://example.com/', tab: { id: 3 }, frameId: 0, documentId: 'ABC' };
    const refused = await new Promise((done) => assert.equal(listener({ schemaVersion: 1, type: 'ui-protect-get-state' }, page, done), true));
    assert.deepEqual(refused, { schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    // Module off by default: the Options page reads state off; a page hello gets an inactive ack.
    mod.protectHost.attach({ hostGranted: () => true, markBadge: () => undefined, markAllBadges: () => undefined });
    const ui = { id: stub.chrome.runtime.id, origin: 'chrome-extension://' + stub.chrome.runtime.id, url: 'chrome-extension://' + stub.chrome.runtime.id + '/options.html#protect', tab: { id: 9 } };
    const state = await new Promise((done) => listener({ schemaVersion: 1, type: 'ui-protect-get-state' }, ui, done));
    assert.equal(state.type, 'protect-state');
    assert.equal(state.state.state, 'off');
    const ack = await new Promise((done) => listener({ schemaVersion: 1, type: 'protect-hello' }, page, done));
    assert.deepEqual(ack, { schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    assert.equal(mod.protectHost.badgeFor(3, 'ru'), null);
    // S4b: while the module is off the firewall popup does nothing (no per-tab popup, no openPopup, no tab read).
    stub.events.onCommitted.listeners[0]({ tabId: 3, frameId: 0, url: 'https://example.com/', documentId: 'A', timeStamp: 1 });
    stub.events.onActivated.listeners[0]({ tabId: 3, windowId: 1 });
    stub.events.onFocusChanged.listeners[0](1);
    await new Promise((done) => setTimeout(done, 400));
    assert.deepEqual(stub.actionCalls, []);
    assert.deepEqual(mod.protectHost.sessionKeys().slice(0, 2), ['protect-tabs', 'protect-runtime']);
    assert.equal(mod.isProtectSessionKey('protect-doc:1:0:A'), true);
    assert.equal(mod.isProtectSessionKey('doc:1:0:A'), false);
    // A malformed production report is skipped without throwing.
    mod.protectHost.reportPersisted('1:0:A', { nonsense: true }, null, () => null);
  } finally {
    delete globalThis.chrome;
  }
});
