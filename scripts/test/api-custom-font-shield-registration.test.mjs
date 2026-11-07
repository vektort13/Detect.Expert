// ADR-110: how the font row reaches the page. The registered source carries the installer and only the hidden names, only when the row is
// Custom in that scope, and the document runtime hands a reused window back to the installer; the compiled source is run in a synthetic realm.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';
import { hiddenFontNames } from '../../apps/production-extension/font-probe-names.js';
import { windowsFonts } from '../../apps/production-extension/fingerprint-font-groups.js';

const tagged = value => ({ kind: 'value', value });
function change(config, id, patch, host = null) { const result = updateApiConfiguration(config, id, patch, host); assert.equal(result.ok, true, result.error?.message); return result.value; }
const base = () => ({ ...createApiConfiguration(), enabled: true, antidetectEnabled: true });
const fonts = (config, families, host = null) => change(config, 'canvas-font-policy', { mode: 'custom', selected: tagged({ families, fallback: 'sans-serif' }) }, host);
const packedOf = code => JSON.parse(/const packed = (.*);\n/u.exec(code)[1]);
const SCOPE = ['https://*/*', 'http://*/*'];

test('a Custom font row compiles the installer, the refresh link and exactly the hidden names; nothing else changes', () => {
  const windows = windowsFonts({ windows11: true });
  const [script] = buildApiCustomScripts(fonts(base(), windows), SCOPE), code = script.js[0].code;
  assert.equal(code.split('function installFontShield').length - 1, 1, 'the installer is serialized once');
  assert.ok(code.includes('install.refresh = realm => { fonts(realm, entries); };'));
  assert.ok(code.indexOf('install.refresh') < code.indexOf('function installApiCustomDocument'), 'the refresher is set before the document runtime starts');
  const row = packedOf(code).find(entry => entry.id === 'canvas-font-policy');
  assert.equal(row.mode, 'custom'); assert.deepEqual(row.selected.value.families, windows);
  assert.deepEqual(row.fontShadow, [...hiddenFontNames(windows)], 'only the names the allow-list does not keep travel to the page');
  assert.ok(row.fontShadow.length > 500 && !row.fontShadow.includes('Arial') && row.fontShadow.includes('Century Gothic'));
  assert.equal(packedOf(code).filter(entry => Object.hasOwn(entry, 'fontShadow')).length, 1);
  assert.ok(code.includes('fontShadow: entry.fontShadow'), 'the page-side entry list carries the names');
  assert.ok(code.includes(' fonts(realm, entries);') && code.indexOf(' fonts(realm, entries);') < code.indexOf(' surfaces(realm, entries'), 'the shield is installed before the Canvas policy');
  assert.deepEqual(buildApiCustomScripts(fonts(base(), windows), SCOPE)[0].js[0].code, code, 'deterministic');
});

test('no font row, a row that is not Custom, master OFF or no scope: no installer and no names', () => {
  const noFonts = change(base(), 'hardware-concurrency', { mode: 'custom', selected: tagged(16) });
  const [script] = buildApiCustomScripts(noFonts, SCOPE);
  assert.ok(!script.js[0].code.includes('function installFontShield') && !script.js[0].code.includes('install.refresh = '), 'another Custom row compiles no shield and no refresher (the document runtime only reads install.refresh)');
  assert.ok(packedOf(script.js[0].code).every(entry => !Object.hasOwn(entry, 'fontShadow')));
  for (const mode of ['off', 'bypass']) {
    const scripts = buildApiCustomScripts(change(fonts(base(), ['Arial']), 'canvas-font-policy', { mode }), SCOPE);
    assert.ok(scripts.every(item => !item.js[0].code.includes('function installFontShield')), mode + ' is not Custom');
  }
  assert.deepEqual(buildApiCustomScripts({ ...fonts(base(), ['Arial']), antidetectEnabled: false, enabled: false }, SCOPE), []);
  assert.deepEqual(buildApiCustomScripts(fonts(base(), ['Arial']), []), []);
});

test('a site rule carries its own hidden names; a site whose font row is Off gets no shield, and the global script stays out of it', () => {
  let config = fonts(base(), ['Arial', 'Segoe UI']);
  config = fonts(config, ['Arial', 'Century Gothic', 'Agency FB'], 'one.example.com');
  config = change(config, 'canvas-font-policy', { mode: 'off' }, 'two.example.com');
  config = change(config, 'canvas-font-policy', { mode: 'bypass' }, 'three.example.com');
  const scripts = buildApiCustomScripts(config, SCOPE), byId = Object.fromEntries(scripts.map(script => [script.id, script]));
  const global = Object.values(byId).find(script => script.id.endsWith('global')), one = Object.values(byId).find(script => script.id.endsWith(Buffer.from('one.example.com').toString('hex')));
  const rowOf = script => packedOf(script.js[0].code).find(entry => entry.id === 'canvas-font-policy');
  assert.deepEqual(rowOf(global).fontShadow, [...hiddenFontNames(['Arial', 'Segoe UI'])]);
  assert.deepEqual(rowOf(one).fontShadow, [...hiddenFontNames(['Arial', 'Century Gothic', 'Agency FB'])]);
  assert.ok(!rowOf(one).fontShadow.includes('Century Gothic') && !rowOf(one).fontShadow.includes('Agency FB') && rowOf(global).fontShadow.includes('Century Gothic'));
  assert.ok(global.excludeMatches.some(pattern => pattern.includes('one.example.com')) && global.excludeMatches.some(pattern => pattern.includes('two.example.com')), 'the sites with their own rule are excluded from the global script');
  const hex = host => Buffer.from(host).toString('hex'), siteScript = host => Object.values(byId).find(script => script.id.endsWith(hex(host)));
  assert.equal(siteScript('two.example.com'), undefined, 'a site whose font row is Off gets no script with the shield');
  // Bypass in a site rule means "inherit the global value": that site receives the global list in its own script.
  const three = siteScript('three.example.com');
  assert.ok(three, 'the Bypass site has a script of its own');
  assert.deepEqual(rowOf(three).fontShadow, [...hiddenFontNames(['Arial', 'Segoe UI'])]);
  assert.ok(global.excludeMatches.some(pattern => pattern.includes('three.example.com')), 'and is excluded from the global one, so the shield is not installed twice');
});

// ---- the compiled source in a synthetic realm: the shield is adopted at document start and again when the document is replaced ----
function realm() {
  const context = vm.createContext({ DOMException });
  vm.runInContext(`
    const owner = new WeakMap(), lists = new WeakMap(), texts = new WeakMap();
    class Document {
      querySelectorAll() { return []; } write() {} writeln() {} open() { return this; }
      get adoptedStyleSheets() { return [...(lists.get(this) ?? [])]; } set adoptedStyleSheets(value) { const next = [...value]; for (const sheet of next) if (owner.get(sheet) !== this) throw new DOMException('wrong document', 'NotAllowedError'); lists.set(this, next); }
    }
    class CSSStyleSheet { constructor() { owner.set(this, current); } replaceSync(text) { texts.set(this, String(text)); } }
    let current = new Document();
    globalThis.Document = Document; globalThis.CSSStyleSheet = CSSStyleSheet; globalThis.FontFace = class FontFace { constructor(family, source) { globalThis.lastSource = source; } };
    Object.defineProperty(globalThis, 'document', { get() { return current; }, enumerable: true, configurable: false });
    globalThis.swapDocument = () => { current = new Document(); };
    globalThis.sheets = target => [...(lists.get(target) ?? [])]; globalThis.textOf = sheet => texts.get(sheet);
    globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator();
  `, context);
  return context;
}

test('the compiled source adopts the shield at document start and the document runtime re-adopts it when a new document reuses the window', () => {
  const [script] = buildApiCustomScripts(fonts(base(), ['Arial', 'Segoe UI']), SCOPE), hidden = hiddenFontNames(['Arial', 'Segoe UI']);
  const context = realm(); vm.runInContext(script.js[0].code, context);
  const run = source => vm.runInContext(source, context);
  assert.equal(run('sheets(document).length'), 1);
  assert.equal(run('textOf(sheets(document)[0]).split("@font-face").length - 1'), hidden.length);
  assert.equal(run('new FontFace("p", "local(\\"Century Gothic\\")") && lastSource'), 'local("detect.expert absent")');
  // The document runtime's own calls reach the refresher: a replaced document gets its sheet on the next document write/open.
  run('swapDocument()'); assert.equal(run('sheets(document).length'), 0);
  run('document.write("x")');
  assert.equal(run('sheets(document).length'), 1, 'protect() of an already installed window calls install.refresh');
  run('document.write("y"); document.open();');
  assert.equal(run('sheets(document).length'), 1, 'and only once per document');
});

test('a script without the font row never defines the refresher and the document runtime tolerates its absence', () => {
  const [script] = buildApiCustomScripts(change(base(), 'hardware-concurrency', { mode: 'custom', selected: tagged(16) }), SCOPE);
  const context = realm(); vm.runInContext(script.js[0].code, context);
  assert.doesNotThrow(() => vm.runInContext('swapDocument(); document.write("x"); document.open();', context));
  assert.equal(vm.runInContext('sheets(document).length', context), 0);
});
