import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { PRODUCTION_LANGUAGES } from '../../production-languages.mjs';

const root = resolve(import.meta.dirname, '../../..');
async function load(path) {
  const built = await build({ entryPoints: [resolve(root, path)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const target = await load('apps/production-protect/src/findings-target.ts');
const position = await load('apps/production-protect/src/ui/findings-position.ts');
const shim = await load('apps/production-protect/src/ui/i18n-shim.ts');

test('findings target binds one canonical top-level document to its exact tab', () => {
  assert.deepEqual(target.readFindingsTarget('?tab=7&document=7%3A0%3ADOC-1_a'), { tabId: 7, documentKey: '7:0:DOC-1_a' });
  assert.deepEqual(target.readFindingsTarget('?document=0%3A0%3ADOC&tab=0'), { tabId: 0, documentKey: '0:0:DOC' });
  for (const query of ['', '?tab=7', '?document=7:0:DOC', '?tab=07&document=07:0:DOC', '?tab=-1&document=-1:0:DOC', '?tab=2147483648&document=2147483648:0:DOC', '?tab=7&document=8:0:DOC', '?tab=7&document=7:1:DOC', '?tab=7&document=7:0:', '?tab=7&document=7:0:DOC:other', '?tab=7&document=7:0:%xx', '?tab=7&document=7:0:DOC&tab=7', '?tab=7&document=7:0:DOC&document=7:0:DOC', '?tab=7&document=7:0:DOC&extra=true', '?tab=7&document=7:0:' + 'X'.repeat(65)]) assert.equal(target.readFindingsTarget(query), null, query);
});

test('findings bounds use outer-window pixels and stay inside negative and small work areas', () => {
  assert.deepEqual(position.findingsWindowBounds({ left: 0, top: 0, width: 1920, height: 1040 }), { left: 1484, top: 264, width: 420, height: 760 });
  assert.deepEqual(position.findingsWindowBounds({ left: -1920, top: -100, width: 1920, height: 1080 }), { left: -436, top: 204, width: 420, height: 760 });
  assert.deepEqual(position.findingsWindowBounds({ left: 0, top: 0, width: 1920, height: 1040 }, 240), { left: 1484, top: 784, width: 420, height: 240 });
  assert.equal(position.findingsWindowBounds({ left: 0, top: 0, width: 1920, height: 1040 }, 10).height, 220);
  assert.equal(position.findingsWindowBounds({ left: 0, top: 0, width: 1920, height: 1040 }, 1000).height, 760);
  for (const area of [{ left: -300, top: 200, width: 300, height: 250 }, { left: 10, top: -10, width: 1, height: 1 }, { left: 0, top: 0, width: 420, height: 560 }]) {
    const bounds = position.findingsWindowBounds(area);
    assert.ok(bounds.left >= area.left && bounds.top >= area.top);
    assert.ok(bounds.left + bounds.width <= area.left + area.width);
    assert.ok(bounds.top + bounds.height <= area.top + area.height);
    assert.ok(bounds.width <= 420 && bounds.height <= 760 && bounds.width > 0 && bounds.height > 0);
  }
  for (const bad of [{ left: NaN, top: 0, width: 100, height: 100 }, { left: 0, top: 0, width: 0, height: 100 }, { left: 0, top: 0, width: 100, height: Infinity }]) assert.equal(position.findingsWindowBounds(bad), null);
});

test('self-position updates only its own popup and preserves focus', async () => {
  const oldScreen = globalThis.screen, oldChrome = globalThis.chrome;
  const updates = [];
  globalThis.screen = { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 };
  globalThis.chrome = { windows: { getCurrent: async () => ({ id: 11, type: 'popup' }), update: async (...args) => updates.push(args) } };
  try {
    assert.equal(await position.positionFindingsWindow(), true);
    assert.deepEqual(updates, [[11, { left: -436, top: 304, width: 420, height: 760 }]]);
    globalThis.chrome.windows.getCurrent = async () => ({ id: 11, type: 'normal' });
    assert.equal(await position.positionFindingsWindow(), false);
    assert.equal(updates.length, 1, 'normal browser window must never be resized');
  } finally {
    if (oldScreen === undefined) delete globalThis.screen; else globalThis.screen = oldScreen;
    if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome;
  }
});

test('findings chrome has all 21 production languages with exact substitutions and no new consent text', () => {
  const catalog = JSON.parse(readFileSync(resolve(root, 'apps/production-protect/src/locales/findings.json'), 'utf8'));
  assert.deepEqual(Object.keys(catalog).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  const keys = Object.keys(catalog.en).sort();
  assert.equal(keys.length, 7);
  const fullCatalog = JSON.parse(readFileSync(resolve(root, 'apps/production-protect/src/locales/catalog.generated.json'), 'utf8'));
  assert.deepEqual(shim.catalogSize(), { ru: Object.keys(fullCatalog.ru).length, en: Object.keys(fullCatalog.en).length });
  for (const key of keys) assert.equal(Object.hasOwn(fullCatalog.en, key), false, 'findings chrome stays in its own overlay: ' + key);
  for (const { id } of PRODUCTION_LANGUAGES) {
    assert.deepEqual(Object.keys(catalog[id]).sort(), keys, id);
    shim.setProductionLocale(id);
    for (const key of keys) {
      const text = catalog[id][key].message;
      assert.ok(text.trim().length > 0 && !text.includes('?') && !key.includes('consent'), id + '/' + key);
      assert.deepEqual([...text.matchAll(/\$\d/g)].map(match => match[0]), key === 'findings_popup_transfer_count' ? ['$1'] : [], id + '/' + key);
      assert.equal(shim.t(key, ['12']), text.replace('$1', '12'), id + '/' + key);
    }
  }
});

test('report responses from a previous eligibility epoch cannot populate a re-enabled page or clear its current read', async () => {
  const slots = [], effects = [], requests = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value; }]; },
    useRef(initial) { return (slots[cursor++] ??= { current: initial }); },
    useCallback(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!same(slot.dependencies, dependencies)) { slot.dependencies = dependencies; slot.callback = callback; } return slot.callback; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!same(slot.dependencies, dependencies)) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const previous = { hooks: globalThis.__findingsHooks, read: globalThis.__findingsRead, window: globalThis.window };
  globalThis.__findingsHooks = hooks;
  globalThis.__findingsRead = tabId => new Promise(resolve => requests.push({ tabId, resolve }));
  globalThis.window = { setInterval: () => 1 };
  const built = await build({
    entryPoints: [resolve(root, 'apps/production-protect/src/ui/findings-report.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent',
    plugins: [{ name: 'hook-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^preact\/hooks$/ }, () => ({ path: 'hooks', namespace: 'fixture' }));
      plugin.onResolve({ filter: /\/messaging$/ }, () => ({ path: 'messaging', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'hooks'
        ? 'export const useState=(...a)=>globalThis.__findingsHooks.useState(...a); export const useRef=(...a)=>globalThis.__findingsHooks.useRef(...a); export const useCallback=(...a)=>globalThis.__findingsHooks.useCallback(...a); export const useEffect=(...a)=>globalThis.__findingsHooks.useEffect(...a);'
        : 'export const protectUi={getReport:tabId=>globalThis.__findingsRead(tabId)};' }));
    } }],
  });
  const hook = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const draw = (enabled, tabId = 7) => { cursor = 0; const result = hook.useFindingsReport(tabId, enabled); effects.splice(0).forEach(effect => effect()); return result; };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    draw(true);
    assert.equal(requests.length, 1);
    draw(false);
    draw(true);
    assert.equal(requests.length, 2, 'new eligibility epoch gets a new read immediately');
    requests[0].resolve({ ok: true, response: { report: { documentKey: '7:0:STALE' } } });
    await settle();
    let session = draw(true);
    assert.equal(session.report, null);
    assert.equal(session.loaded, false);
    void session.refresh();
    assert.equal(requests.length, 2, 'old finally cannot unlock the current read');
    const currentReport = { documentKey: '7:0:CURRENT' };
    requests[1].resolve({ ok: true, response: { report: currentReport } });
    await settle();
    session = draw(true);
    assert.equal(session.report, currentReport);
    assert.equal(session.loaded, true);
    session = draw(true, 8);
    assert.equal(session.report, null, 'old target data is hidden synchronously before the next effect');
    assert.equal(session.loaded, false);
    assert.equal(requests.length, 3);
    requests[2].resolve({ ok: true, response: { report: { documentKey: '8:0:CURRENT' } } });
    await settle();
  } finally {
    for (const slot of slots) slot.cleanup?.();
    if (previous.hooks === undefined) delete globalThis.__findingsHooks; else globalThis.__findingsHooks = previous.hooks;
    if (previous.read === undefined) delete globalThis.__findingsRead; else globalThis.__findingsRead = previous.read;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
  }
});
