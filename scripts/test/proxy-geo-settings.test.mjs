// ADR-109: the settings page of the Proxy Manager Geolocation API, run without a browser against the real static markup. A small DOM
// stands in for the browser and a fake controller follows GeoState and the method signatures of docs/coverage/proxy-geolocation.md
// exactly (it is built from the real strict readers of proxy-geo-shared.js). The page must call only the controller, show every state,
// never echo a key and never turn provider text into markup. Real browsers: proxy-geo-settings-native.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GEO_ERRORS, GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_TEST_IP, defaultGeoSettings, geoCleanCredential, geoProviderState, geoReadyProviders, geoSettingsPatch, normalizeGeoCredentials,
} from '../../apps/production-extension/proxy-geo-shared.js';
import { mountProxyGeoSettings, proxyGeoErrorKey, proxyGeoMasterView, proxyGeoRecordSummary } from '../../apps/production-extension/proxy-geo-settings.js';
import { PROXY_GEO_SETTINGS_MESSAGES, proxyGeoFill, proxyGeoSettingsLabels } from '../../apps/production-extension/proxy-geo-settings-labels.js';
import { LANGUAGES } from '../../apps/production-extension/precursor-settings-locales.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { buildPaletteEntries } from '../../apps/production-extension/management-ui.js';
import { rankPaletteEntries } from '../../apps/production-extension/management-hub.js';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';

const directory = new URL('../../apps/production-extension/', import.meta.url);
const read = name => readFileSync(new URL(name, directory), 'utf8');
const HTML = read('proxy-geo-settings.html');
const kebab = key => String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
const flush = () => new Promise(resolve => setImmediate(resolve));
const EN = proxyGeoSettingsLabels('en'), RU = proxyGeoSettingsLabels('ru');

// ---- A minimal DOM ---------------------------------------------------------------------------------------------------------------
class FakeEvent {
  constructor(type, init = {}) { this.type = type; this.bubbles = false; this.defaultPrevented = false; Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
}
class TextNode {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
}
const compound = text => {
  const tests = [];
  let rest = text, found = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
  if (found) { const name = found[0].toLowerCase(); tests.push(node => node.localName.toLowerCase() === name); rest = rest.slice(found[0].length); }
  while (rest) {
    if ((found = /^#([\w-]+)/.exec(rest))) { const id = found[1]; tests.push(node => node.getAttribute('id') === id); }
    else if ((found = /^\.([\w-]+)/.exec(rest))) { const name = found[1]; tests.push(node => (node.getAttribute('class') ?? '').split(/\s+/).includes(name)); }
    else if ((found = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/.exec(rest))) { const [, name, quoted, bare] = found, expected = quoted ?? bare; tests.push(node => (expected === undefined ? node.hasAttribute(name) : node.getAttribute(name) === expected)); }
    else throw new Error('unsupported selector: ' + text);
    rest = rest.slice(found[0].length);
  }
  return node => tests.every(test => test(node));
};
const selector = text => text.split(',').map(part => part.trim().split(/\s+/).map(compound));
function matchesChain(node, chain) {
  if (!chain.at(-1)(node)) return false;
  let at = chain.length - 2;
  for (let up = node.parentNode; at >= 0 && up; up = up.parentNode) if (up.nodeType === 1 && chain[at](up)) at--;
  return at < 0;
}
class Element {
  constructor(doc, localName, namespace = 'html') {
    this.nodeType = 1; this.ownerDocument = doc; this.localName = localName; this.tagName = localName.toUpperCase(); this.namespace = namespace;
    this.attributes = new Map(); this.childNodes = []; this.parentNode = null; this.listeners = new Map(); this.checked = false; this.valueText = null;
    this.dataset = new Proxy({}, { get: (_, key) => this.getAttribute('data-' + kebab(key)) ?? undefined, set: (_, key, value) => { this.setAttribute('data-' + kebab(key), String(value)); return true; } });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get id() { return this.getAttribute('id') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get className() { return this.getAttribute('class') ?? ''; }
  set href(value) { this.setAttribute('href', value); }
  get href() { return this.getAttribute('href') ?? ''; }
  get type() { return this.getAttribute('type') ?? 'text'; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) {
    if (value) { this.setAttribute('disabled', ''); if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; } // the focus fix-up of real browsers
    else this.removeAttribute('disabled');
  }
  get value() {
    if (this.localName === 'select') return this.valueText ?? this.querySelector('option')?.getAttribute('value') ?? '';
    return this.valueText ?? this.getAttribute('value') ?? '';
  }
  set value(next) { this.valueText = String(next); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value !== '' && value !== null && value !== undefined) this.append(String(value));
  }
  get isConnected() { for (let node = this; node; node = node.parentNode) if (node === this.ownerDocument) return true; return false; }
  append(...items) {
    for (const item of items) {
      const node = typeof item === 'string' ? new TextNode(item) : item;
      node.parentNode?.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this; this.childNodes.push(node);
    }
  }
  replaceChildren(...items) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; this.append(...items); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false; }
  walk(visit) { for (const child of this.children) { visit(child); child.walk(visit); } }
  querySelectorAll(text) { const chains = selector(text), found = []; this.walk(node => { if (chains.some(chain => matchesChain(node, chain))) found.push(node); }); return found; }
  querySelector(text) { return this.querySelectorAll(text)[0] ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)); }
  dispatchEvent(event) {
    event.target ??= this;
    for (let node = this; node; node = event.bubbles ? node.parentNode : null) for (const listener of [...(node.listeners?.get(event.type) ?? [])]) listener.call(node, event);
    return !event.defaultPrevented;
  }
  fire(type, init = {}) { const event = new FakeEvent(type, init); this.dispatchEvent(event); return event; }
  click() { if (!this.disabled) this.fire('click', { bubbles: true }); }
  focus() { if (!this.disabled && this.isConnected) this.ownerDocument.setActive(this); }
}
class FakeDocument {
  constructor() {
    this.nodeType = 9; this.listeners = new Map(); this.title = ''; this.visibilityState = 'visible';
    this.documentElement = new Element(this, 'html'); this.body = new Element(this, 'body'); this.documentElement.append(this.body); this.documentElement.parentNode = this; this.activeElement = this.body;
  }
  createElement(name) { return new Element(this, name.toLowerCase()); }
  createElementNS(namespace, name) { return new Element(this, name, namespace); }
  getElementById(id) { return this.documentElement.querySelector('#' + id); }
  querySelectorAll(text) { return this.documentElement.querySelectorAll(text); }
  querySelector(text) { return this.documentElement.querySelector(text); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)); }
  dispatchEvent(event) { for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener.call(this, event); }
  setActive(node) {
    const previous = this.activeElement;
    if (previous === node) return;
    this.activeElement = node;
    previous.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: node }));
    node.dispatchEvent(new FakeEvent('focusin', { bubbles: true, relatedTarget: previous }));
  }
}
// The real static markup of the page, parsed by a tiny tokenizer (the file only uses plain tags, quoted attributes and text).
function parseHtml(source) {
  const doc = new FakeDocument(), stack = [], VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr']);
  const tokens = /<!doctype[^>]*>|<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  for (const match of source.matchAll(tokens)) {
    if (match[1]) { while (stack.length && stack.pop().localName !== match[1].toLowerCase()); continue; }
    if (match[2]) {
      const name = match[2].toLowerCase(), node = name === 'html' ? doc.documentElement : name === 'body' ? doc.body : doc.createElement(name);
      for (const attribute of (match[3] ?? '').matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      if (name === 'html' || name === 'body') { if (name === 'body') doc.documentElement.append(node); } else (stack.at(-1) ?? doc.documentElement).append(node);
      if (name === 'html' || name === 'body') stack.push(node);
      else if (!VOID.has(name)) stack.push(node);
      continue;
    }
    if (match[4] !== undefined && match[4].trim() !== '') (stack.at(-1) ?? doc.body).append(match[4].replace(/\s+/g, ' '));
  }
  doc.activeElement = doc.body;
  return doc;
}

// ---- A fake controller that follows GeoState and the documented method signatures ------------------------------------------------
function fakeController(init = {}) {
  const calls = [], listeners = new Set(), gates = new Map(), secrets = {}, scripted = {}, broken = new Set();
  const model = { loaded: init.loaded !== false, settings: geoSettingsPatch(defaultGeoSettings(), init.settings ?? {}), cacheCount: init.cacheCount ?? 0,
    runtime: Object.fromEntries(GEO_PROVIDERS.map(id => [id, { status: 'idle', error: null, okAt: null, remaining: null, pausedUntil: null, ...(init.runtime?.[id] ?? {}) }])) };
  for (const [id, value] of Object.entries(init.keys ?? {})) { secrets[id] = geoCleanCredential(id, value); assert.ok(secrets[id], 'fixture key for ' + id); }
  let revision = 0;
  const build = () => {
    const settings = model.settings, credentials = normalizeGeoCredentials({ version: 1, items: { ...secrets } }), readyProviders = geoReadyProviders(settings, credentials);
    return Object.freeze({
      loaded: model.loaded, revision, settings, enabled: settings.enabled, ready: settings.enabled && readyProviders.length > 0, readyProviders,
      hasCredentials: Object.fromEntries(GEO_PROVIDERS.map(id => [id, Object.hasOwn(credentials.items, id)])),
      providers: Object.fromEntries(GEO_PROVIDERS.map(id => { const known = geoProviderState(settings, credentials, id); return [id, { enabled: known.enabled, ready: known.ready, reason: known.reason, ...model.runtime[id] }]; })),
      records: Object.create(null), pending: Object.create(null), errors: Object.create(null), cacheCount: model.cacheCount,
    });
  };
  let state = build();
  const touch = () => { revision++; state = build(); queueMicrotask(() => { for (const listener of [...listeners]) listener(); }); };
  const step = async (name, args, work) => {
    calls.push([name, ...args.map(value => structuredClone(value))]);
    const gate = gates.get(name);
    if (gate) await gate.promise;
    if (broken.has(name)) throw new Error('storage failed');
    return work();
  };
  const controller = {
    calls, secrets, scripted, broken,
    actions: () => calls.filter(call => call[0] !== 'load'),
    hold(name) { let release; const promise = new Promise(resolve => { release = resolve; }); gates.set(name, { promise }); return { release: () => { gates.delete(name); release(); } }; },
    runtime(id, patch) { Object.assign(model.runtime[id], patch); touch(); },
    external(patch) { if (patch.settings) model.settings = geoSettingsPatch(model.settings, patch.settings); if ('cacheCount' in patch) model.cacheCount = patch.cacheCount; touch(); },
    load: () => step('load', [], async () => { model.loaded = true; state = build(); return state; }),
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setEnabled: value => step('setEnabled', [value], async () => { model.settings = geoSettingsPatch(model.settings, { enabled: value }); touch(); return { ok: true }; }),
    setOption: (option, value) => step('setOption', [option, value], async () => { model.settings = geoSettingsPatch(model.settings, { [option]: value }); touch(); return { ok: true }; }),
    setProvider: (id, patch) => step('setProvider', [id, patch], async () => { model.settings = geoSettingsPatch(model.settings, { providers: { [id]: patch } }); touch(); return { ok: true }; }),
    saveCredential: (id, input) => step('saveCredential', [id, input], async () => {
      const clean = geoCleanCredential(id, input);
      if (clean === null) return { ok: false, error: 'invalid-key' };
      secrets[id] = clean; touch(); return { ok: true };
    }),
    forgetCredential: id => step('forgetCredential', [id], async () => { delete secrets[id]; touch(); return { ok: true }; }),
    forgetAllCredentials: () => step('forgetAllCredentials', [], async () => { for (const id of Object.keys(secrets)) delete secrets[id]; touch(); return { ok: true }; }),
    clearCache: () => step('clearCache', [], async () => { model.cacheCount = 0; touch(); return { ok: true }; }),
    testProvider: id => step('testProvider', [id], async () => scripted[id] ?? { ok: false, error: 'no-key' }),
    dispose: () => { calls.push(['dispose']); },
  };
  return controller;
}

function fakeApi({ language = 'en', stored = {} } = {}) {
  const store = { ...stored }, writes = [], handlers = new Set();
  return {
    store, writes, handlers,
    runtime: { getURL: path => 'chrome-extension://own/' + path },
    i18n: { getUILanguage: () => language },
    storage: {
      local: {
        async get(key) { return Object.hasOwn(store, key) ? { [key]: store[key] } : {}; },
        async set(values) { writes.push(structuredClone(values)); Object.assign(store, values); for (const [key, newValue] of Object.entries(values)) for (const handler of [...handlers]) handler({ [key]: { newValue } }, 'local'); },
      },
      onChanged: { addListener: handler => handlers.add(handler), removeListener: handler => handlers.delete(handler) },
    },
  };
}
function fakeEnv() {
  const timers = new Map(), events = new Map();
  let sequence = 0;
  return {
    setTimeout: (callback, ms) => { timers.set(++sequence, { callback, ms }); return sequence; },
    clearTimeout: id => { timers.delete(id); },
    addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type),
    timers, events, tick: () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
  };
}
async function mountPage({ language = 'en', stored, controller = fakeController(), api = fakeApi({ language, stored }), theme = () => Promise.resolve(), env = fakeEnv(), skeleton = HTML } = {}) {
  const doc = parseHtml(skeleton), page = mountProxyGeoSettings({ document: doc, api, env, controller, theme });
  await flush();
  const $ = text => doc.querySelector(text), card = id => doc.querySelector('[data-geo-provider="' + id + '"]');
  const part = (id, text) => card(id).querySelector(text);
  return {
    doc, page, api, env, ctl: controller, $, card, part, L: () => proxyGeoSettingsLabels(doc.documentElement.lang === 'ru' ? 'ru' : 'en'),
    click: async node => { (typeof node === 'string' ? $(node) : node).click(); await flush(); },
    type(node, text) { node.value = text; node.fire('input', { bubbles: true }); },
    text: text => $(text).textContent,
  };
}
const everything = doc => {
  const out = [];
  const visit = node => { for (const child of node.childNodes) { if (child.nodeType === 3) out.push(child.data); else { for (const [name, value] of child.attributes) out.push(name + '=' + value); if (child.valueText) out.push(child.valueText); visit(child); } } };
  visit(doc.documentElement);
  return out.join('\n');
};
const controlsOf = t => [...t.$('#pg-content').querySelectorAll('button, input, select')];

// ---- Markup ----------------------------------------------------------------------------------------------------------------------
test('markup: extension scripts and styles only, theme bootstrap first and themes.css last, every hook the script needs', () => {
  const doc = parseHtml(HTML);
  assert.equal(doc.querySelector('title').textContent, 'Proxy Manager Geolocation API · Detect.Expert');
  assert.deepEqual(doc.querySelectorAll('script').map(node => [node.getAttribute('src'), node.getAttribute('type'), node.textContent]), [['theme-bootstrap.js', null, ''], ['proxy-geo-settings.js', 'module', '']], 'no inline script');
  assert.deepEqual(doc.querySelectorAll('link').map(node => node.getAttribute('href')), ['ui.css', 'proxy-geo-settings.css', 'themes.css']);
  assert.ok(HTML.indexOf('theme-bootstrap.js') < HTML.indexOf('ui.css'), 'the theme is applied before the first paint');
  doc.documentElement.walk(node => { for (const [name, value] of node.attributes) { assert.doesNotMatch(name, /^on/i, 'no inline handler'); assert.doesNotMatch(value, /https?:/i, 'no remote address in markup'); } });
  const main = doc.querySelector('#proxy-geo-settings');
  assert.ok(main && main.getAttribute('aria-busy') === 'true' && main.className.includes('pg-shell'));
  assert.ok(doc.querySelector('#pg-content') && doc.querySelector('select#pg-language'));
  const message = doc.querySelector('[data-geo-message]');
  assert.ok(message.getAttribute('role') === 'alert' && message.hidden, 'the alert line exists and starts hidden');
  assert.equal(doc.querySelector('.pg-back').getAttribute('href'), 'options.html#integrations');
  assert.equal(doc.querySelector('h1').textContent, 'Proxy Manager Geolocation API');
  for (const node of doc.querySelectorAll('[data-i18n]')) for (const table of [PROXY_GEO_SETTINGS_MESSAGES.en, PROXY_GEO_SETTINGS_MESSAGES.ru]) assert.ok(table[node.getAttribute('data-i18n')], 'label for ' + node.getAttribute('data-i18n'));
});

test('the page script and markup name no network API, no markup injection and no remote address but the SVG namespace', () => {
  const script = read('proxy-geo-settings.js');
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Image|eval|innerHTML|outerHTML|insertAdjacentHTML|document\.write|storage\.sync|sendMessage)\b/);
  assert.doesNotMatch(script, /new Function|import\(/);
  assert.deepEqual([...script.matchAll(/https?:\/\/[^\s'"`<>]+/g)].map(match => match[0]), ['http://www.w3.org/2000/svg']);
  for (const name of ['proxy-geo-settings.html', 'proxy-geo-settings.css', 'proxy-geo-settings-labels.js']) assert.doesNotMatch(read(name), /https?:\/\//, name + ' has no remote address');
  assert.doesNotMatch(read('proxy-geo-settings.css'), /@import|url\(/, 'no external stylesheet or image');
});

// ---- Rendering of every GeoState variant -----------------------------------------------------------------------------------------
test('loading: nothing can be changed, the chip says so, the language select stays usable; the answer unlocks the page', async () => {
  const controller = fakeController({ loaded: false }), hold = controller.hold('load');
  const t = await mountPage({ controller });
  assert.equal(t.text('[data-geo-state]'), EN.state_loading);
  assert.equal(t.$('[data-geo-state]').getAttribute('data-state'), 'loading');
  assert.equal(t.$('#proxy-geo-settings').getAttribute('aria-busy'), 'true');
  assert.ok(controlsOf(t).length > 30 && controlsOf(t).every(node => node.disabled), 'every control is disabled until the state is loaded');
  assert.equal(t.$('#pg-language').disabled, false); assert.equal(t.$('[data-geo-message]').hidden, true, 'still loading is not an error');
  hold.release(); await flush();
  assert.equal(t.text('[data-geo-state]'), EN.state_off); assert.equal(t.$('#proxy-geo-settings').getAttribute('aria-busy'), 'false'); assert.equal(t.$('[data-geo-master]').disabled, false);
});

test('off, on without a key and ready: the chip, the hint and the switch follow GeoState', async () => {
  const off = await mountPage();
  assert.equal(off.text('[data-geo-state]'), EN.state_off); assert.equal(off.$('[data-geo-master]').getAttribute('aria-checked'), 'false');
  assert.equal(off.$('#proxy-geo-settings').getAttribute('aria-busy'), 'false'); assert.equal(off.text('#pg-master-hint'), EN.hint_off);
  const noKey = await mountPage({ controller: fakeController({ settings: { enabled: true, providers: { ipdata: { enabled: true } } } }) });
  assert.equal(noKey.text('[data-geo-state]'), EN.state_no_key); assert.equal(noKey.$('[data-geo-state]').getAttribute('data-state'), 'no-key');
  assert.equal(noKey.$('[data-geo-master]').getAttribute('aria-checked'), 'true'); assert.equal(noKey.text('#pg-master-hint'), EN.hint_no_key);
  const keys = { maxmind: { accountId: '123456', licenseKey: 'abcdefgh12345' }, ipdata: { apiKey: 'ipdata-fixture-key' } };
  const ready = await mountPage({ controller: fakeController({ settings: { enabled: true, providers: { maxmind: { enabled: true }, ipdata: { enabled: true } } }, keys }) });
  assert.equal(ready.text('[data-geo-state]'), proxyGeoFill(EN.state_ready, { list: 'MaxMind GeoIP / GeoLite, ipdata' }));
  assert.equal(ready.$('[data-geo-state]').getAttribute('data-state'), 'ready'); assert.equal(ready.text('#pg-master-hint'), EN.hint_ready);
  assert.deepEqual(ready.$('[data-geo-state]').querySelectorAll('bdi').map(node => node.textContent), ['MaxMind GeoIP / GeoLite', 'ipdata'], 'proper names are isolated');
  const ru = await mountPage({ language: 'ru', controller: fakeController({ settings: { enabled: true, providers: { ipdata: { enabled: true } } }, keys: { ipdata: keys.ipdata } }) });
  assert.equal(ru.text('[data-geo-state]'), 'Включено — готов: ipdata'); assert.equal(ru.doc.documentElement.lang, 'ru');
  const ruOff = await mountPage({ language: 'ru' });
  assert.equal(ruOff.text('[data-geo-state]'), 'Выключено');
  assert.equal((await mountPage({ language: 'ru', controller: fakeController({ settings: { enabled: true } }) })).text('[data-geo-state]'), 'Включено — нет ключа');
});

test('the helper views agree with the chip, the error key and the one-line summary', () => {
  assert.deepEqual(proxyGeoMasterView(null), { kind: 'loading', names: [] });
  assert.deepEqual(proxyGeoMasterView({ loaded: true, enabled: false }), { kind: 'off', names: [] });
  assert.deepEqual(proxyGeoMasterView({ loaded: true, enabled: true, ready: false, readyProviders: [] }), { kind: 'no-key', names: [] });
  assert.deepEqual(proxyGeoMasterView({ loaded: true, enabled: true, ready: true, readyProviders: ['ipapi', 'bogus'] }), { kind: 'ready', names: ['ip-api.com'] });
  assert.equal(proxyGeoMasterView({ loaded: true, enabled: true, ready: true, readyProviders: [] }).kind, 'no-key', 'ready without a provider is not ready');
  assert.equal(proxyGeoErrorKey('not-public'), 'error_not_public'); assert.equal(proxyGeoErrorKey('<b>x</b>'), 'error_unknown'); assert.equal(proxyGeoErrorKey(undefined), 'error_unknown');
  assert.equal(proxyGeoRecordSummary({ country: 'US', countryName: 'United States', city: 'Mountain View', org: 'Google LLC' }), 'United States · Mountain View · Google LLC');
  assert.equal(proxyGeoRecordSummary({ country: 'US', countryName: '', city: '', org: '' }), 'US'); assert.equal(proxyGeoRecordSummary({}), ''); assert.equal(proxyGeoRecordSummary(null), '');
});

// ---- Switches call exactly the right controller method ---------------------------------------------------------------------------
test('master, option and provider switches each call one controller method with the new value, and show the answer', async () => {
  const t = await mountPage();
  const expected = [];
  const step = async (node, call, checkedNode, checked) => { await t.click(node); expected.push(call); assert.deepEqual(t.ctl.actions(), expected); assert.equal(checkedNode.getAttribute('aria-checked'), String(checked)); };
  await step('[data-geo-master]', ['setEnabled', true], t.$('[data-geo-master]'), true);
  await step('[data-geo-master]', ['setEnabled', false], t.$('[data-geo-master]'), false);
  await step('[data-geo-option="auto"]', ['setOption', 'auto', false], t.$('[data-geo-option="auto"]'), false);
  await step('[data-geo-option="failover"]', ['setOption', 'failover', false], t.$('[data-geo-option="failover"]'), false);
  await step('[data-geo-option="remember"]', ['setOption', 'remember', true], t.$('[data-geo-option="remember"]'), true);
  await step('[data-geo-option="remember"]', ['setOption', 'remember', false], t.$('[data-geo-option="remember"]'), false);
  for (const id of GEO_PROVIDERS) await step(t.part(id, '[data-geo-enabled]'), ['setProvider', id, { enabled: true }], t.part(id, '[data-geo-enabled]'), true);
  await step(t.part('maxmind', '[data-geo-enabled]'), ['setProvider', 'maxmind', { enabled: false }], t.part('maxmind', '[data-geo-enabled]'), false);
  const service = t.part('maxmind', '[data-geo-opt="service"]');
  assert.deepEqual(service.querySelectorAll('option').map(node => node.getAttribute('value')), ['geolite-city', 'geoip-city', 'geoip-insights']);
  service.value = 'geoip-insights'; service.fire('change'); await flush(); expected.push(['setProvider', 'maxmind', { service: 'geoip-insights' }]);
  assert.deepEqual(t.ctl.actions(), expected); assert.equal(service.value, 'geoip-insights');
  const security = t.part('ipgeolocation', '[data-geo-opt="security"]'), http = t.part('ipapi', '[data-geo-opt="http"]');
  security.checked = true; security.fire('change'); await flush(); expected.push(['setProvider', 'ipgeolocation', { security: true }]);
  http.checked = true; http.fire('change'); await flush(); expected.push(['setProvider', 'ipapi', { http: true }]);
  assert.deepEqual(t.ctl.actions(), expected); assert.ok(security.checked && http.checked);
  assert.equal(t.part('ipdata', '[data-geo-opt]'), null, 'ipdata has no extra option'); assert.equal(t.part('maxmind', '[data-geo-opt="security"]'), null);
  assert.ok(controlsOf(t).every(node => !node.disabled || node.hasAttribute('data-geo-forget') || node.hasAttribute('data-geo-forget-all') || node.hasAttribute('data-geo-clear-cache')), 'idle again after every change');
});

test('switches are real buttons with a role, a state, a name and a description; every id is unique and every reference resolves', async () => {
  const t = await mountPage();
  const switches = t.doc.querySelectorAll('[role="switch"]');
  assert.equal(switches.length, 1 + 3 + GEO_PROVIDERS.length);
  const ids = new Set();
  t.doc.documentElement.walk(node => { if (node.id) { assert.ok(!ids.has(node.id), 'duplicate id ' + node.id); ids.add(node.id); } });
  for (const node of switches) {
    assert.equal(node.localName, 'button'); assert.equal(node.getAttribute('type'), 'button'); assert.ok(['true', 'false'].includes(node.getAttribute('aria-checked')));
    for (const attribute of ['aria-labelledby', 'aria-describedby']) for (const id of node.getAttribute(attribute).split(' ')) assert.ok(ids.has(id) && t.doc.getElementById(id).textContent.trim() !== '', attribute + ' -> ' + id);
  }
  for (const node of controlsOf(t)) {
    if (node.localName === 'input') assert.ok(node.parentNode.localName === 'label' && node.parentNode.textContent.trim() !== '', 'a field has a visible label');
    if (node.localName === 'button') assert.ok(node.textContent.trim() !== '' || node.hasAttribute('aria-labelledby'), 'a button has a name');
  }
});

// ---- Keys ------------------------------------------------------------------------------------------------------------------------
test('key fields are password inputs without autofill or spellcheck, left to right, 256 characters at most', async () => {
  const t = await mountPage();
  const fields = t.doc.querySelectorAll('[data-geo-field]');
  assert.deepEqual(fields.map(node => node.getAttribute('data-geo-field')), ['accountId', 'licenseKey', 'apiKey', 'apiKey', 'apiKey']);
  assert.deepEqual(t.card('maxmind').querySelectorAll('[data-geo-field]').map(node => node.getAttribute('data-geo-field')), ['accountId', 'licenseKey']);
  for (const node of fields) {
    assert.equal(node.getAttribute('type'), 'password'); assert.equal(node.getAttribute('autocomplete'), 'off'); assert.equal(node.getAttribute('spellcheck'), 'false');
    assert.equal(node.getAttribute('dir'), 'ltr'); assert.equal(node.getAttribute('maxlength'), '256'); assert.equal(node.valueText, null);
  }
  assert.equal(t.part('maxmind', '[data-geo-field="accountId"]').getAttribute('inputmode'), 'numeric');
  assert.equal(t.part('ipapi', '[data-geo-field="apiKey"]').parentNode.textContent.trim().startsWith(EN.field_apiKey_optional), true, 'the ip-api key is optional');
  assert.equal(t.part('ipdata', '[data-geo-field="apiKey"]').parentNode.textContent.trim().startsWith(EN.field_apiKey), true);
});

test('Save hands the key to the controller once, clears the inputs and never echoes any part of it back', async () => {
  const t = await mountPage();
  const account = '5550123', licence = 'LK_9f3b72c41d_secret', apiKey = 'ipdata-9a7c44e1f0b2-secret';
  t.type(t.part('maxmind', '[data-geo-field="accountId"]'), account); t.type(t.part('maxmind', '[data-geo-field="licenseKey"]'), licence);
  t.type(t.part('ipdata', '[data-geo-field="apiKey"]'), apiKey);
  assert.ok(everything(t.doc).includes(licence), 'what is being typed is in its own field');
  await t.click(t.part('maxmind', '[data-geo-save]'));
  assert.deepEqual(t.ctl.actions(), [['saveCredential', 'maxmind', { accountId: account, licenseKey: licence }]]);
  assert.equal(t.part('maxmind', '[data-geo-field="accountId"]').value, ''); assert.equal(t.part('maxmind', '[data-geo-field="licenseKey"]').value, '');
  assert.equal(t.part('maxmind', '[data-geo-result]').textContent, EN.result_saved_off, 'the provider is off, and the card says so');
  assert.equal(t.part('maxmind', '[data-geo-key]').textContent, EN.key_saved); assert.equal(t.part('maxmind', '[data-geo-key]').getAttribute('data-has'), 'true');
  assert.equal(t.part('maxmind', '[data-geo-forget]').disabled, false); assert.equal(t.part('ipdata', '[data-geo-forget]').disabled, true, 'nothing to remove there');
  await t.click(t.part('ipdata', '[data-geo-enabled]')); await t.click(t.part('ipdata', '[data-geo-save]'));
  assert.equal(t.part('ipdata', '[data-geo-result]').textContent, EN.result_saved, 'an enabled provider just says saved');
  const page = everything(t.doc);
  for (const secret of [account, licence, apiKey, licence.slice(0, 8), licence.slice(-8), apiKey.slice(0, 8), apiKey.slice(-8)]) assert.ok(!page.includes(secret), 'no part of a saved key is in the page: ' + secret);
  assert.ok(!JSON.stringify(t.ctl.getState()).includes('secret'), 'and none in the state');
});

test('an invalid key shows an inline message, marks the field and moves the focus there; typing clears both', async () => {
  const t = await mountPage();
  const field = t.part('ipgeolocation', '[data-geo-field="apiKey"]');
  t.type(field, 'short'); await t.click(t.part('ipgeolocation', '[data-geo-save]'));
  assert.equal(t.part('ipgeolocation', '[data-geo-result]').textContent, EN.invalid_key); assert.equal(t.part('ipgeolocation', '[data-geo-result]').getAttribute('data-kind'), 'error');
  assert.equal(field.getAttribute('aria-invalid'), 'true'); assert.equal(t.doc.activeElement, field); assert.equal(field.value, 'short', 'the text stays so a typo can be fixed');
  assert.equal(t.part('ipgeolocation', '[data-geo-key]').getAttribute('data-has'), 'false');
  t.type(field, 'short2'); assert.equal(field.getAttribute('aria-invalid'), null); assert.equal(t.part('ipgeolocation', '[data-geo-result]').textContent, '');
  const account = t.part('maxmind', '[data-geo-field="accountId"]'), licence = t.part('maxmind', '[data-geo-field="licenseKey"]');
  t.type(account, 'abc'); t.type(licence, 'valid-licence-key'); await t.click(t.part('maxmind', '[data-geo-save]'));
  assert.equal(t.part('maxmind', '[data-geo-result]').textContent, EN.invalid_maxmind);
  assert.deepEqual([account.getAttribute('aria-invalid'), licence.getAttribute('aria-invalid')], ['true', 'false'], 'only the faulty field is marked'); assert.equal(t.doc.activeElement, account);
  t.type(licence, ''); t.type(account, '1234'); await t.click(t.part('maxmind', '[data-geo-save]'));
  assert.deepEqual([account.getAttribute('aria-invalid'), licence.getAttribute('aria-invalid')], ['false', 'true']);
});

test('Enter in a key field saves; Remove key forgets one provider and clears its fields; the eye only changes how the card shows what is typed', async () => {
  const t = await mountPage({ controller: fakeController({ keys: { ipdata: { apiKey: 'stored-fixture-key' } } }) });
  const field = t.part('ipdata', '[data-geo-field="apiKey"]'), reveal = t.part('ipdata', '[data-geo-reveal]');
  t.type(field, 'another-fixture-key'); field.fire('keydown', { key: 'Enter' }); await flush();
  assert.deepEqual(t.ctl.actions(), [['saveCredential', 'ipdata', { apiKey: 'another-fixture-key' }]]);
  t.type(field, 'typed-not-saved-yet'); await t.click(reveal);
  assert.equal(field.getAttribute('type'), 'text'); assert.equal(reveal.getAttribute('aria-pressed'), 'true'); assert.equal(reveal.textContent.trim(), EN.reveal_hide);
  assert.equal(t.part('ipapi', '[data-geo-field="apiKey"]').getAttribute('type'), 'password', 'only this card');
  assert.deepEqual(t.ctl.actions().length, 1, 'showing a key calls nothing');
  t.doc.visibilityState = 'hidden'; t.doc.dispatchEvent(new FakeEvent('visibilitychange'));
  assert.equal(field.getAttribute('type'), 'password', 'leaving the tab hides it again'); assert.equal(reveal.getAttribute('aria-pressed'), 'false'); t.doc.visibilityState = 'visible';
  await t.click(reveal); await t.click(t.part('ipdata', '[data-geo-forget]'));
  assert.deepEqual(t.ctl.actions().at(-1), ['forgetCredential', 'ipdata']);
  assert.equal(field.value, ''); assert.equal(field.getAttribute('type'), 'password'); assert.equal(t.part('ipdata', '[data-geo-result]').textContent, EN.result_forgot);
  assert.equal(t.part('ipdata', '[data-geo-forget]').disabled, true); assert.equal(t.doc.activeElement, field, 'the focus goes to the empty field, not to the disabled button');
});

// ---- Test key --------------------------------------------------------------------------------------------------------------------
const GOOGLE = Object.freeze({ provider: 'ipdata', service: '', at: 1, ip: GEO_TEST_IP, country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: 'Google LLC', isp: '', kind: 'hosting', flags: {} });
test('Test key shows the answer for the test address, works while the master switch is off, and every error code has its own sentence', async () => {
  const t = await mountPage({ controller: fakeController({ keys: { ipdata: { apiKey: 'ipdata-fixture-key' } } }) });
  assert.equal(t.$('[data-geo-master]').getAttribute('aria-checked'), 'false');
  t.ctl.scripted.ipdata = { ok: true, record: GOOGLE };
  await t.click(t.part('ipdata', '[data-geo-test]'));
  assert.deepEqual(t.ctl.actions(), [['testProvider', 'ipdata']]);
  assert.equal(t.part('ipdata', '[data-geo-result]').textContent, proxyGeoFill(EN.test_ok, { ip: GEO_TEST_IP, summary: 'United States · Mountain View · Google LLC' }));
  assert.ok(t.card('ipdata').textContent.includes(GEO_TEST_IP), 'the card says which address is looked up');
  t.ctl.scripted.ipdata = { ok: true, record: { ...GOOGLE, countryName: '', country: '', city: '', org: '' } };
  await t.click(t.part('ipdata', '[data-geo-test]'));
  assert.equal(t.part('ipdata', '[data-geo-result]').textContent, proxyGeoFill(EN.test_ok_empty, { ip: GEO_TEST_IP }));
  for (const [language, labels] of [['en', EN], ['ru', RU]]) {
    const page = await mountPage({ language, controller: fakeController({ keys: { ipdata: { apiKey: 'ipdata-fixture-key' } } }) }), sentences = new Set();
    for (const code of GEO_ERRORS) {
      page.ctl.scripted.ipdata = { ok: false, error: code };
      await page.click(page.part('ipdata', '[data-geo-test]'));
      const line = page.part('ipdata', '[data-geo-result]');
      assert.equal(line.textContent, labels['error_' + code.replaceAll('-', '_')], language + ': ' + code); assert.equal(line.getAttribute('data-kind'), 'error');
      assert.ok(line.textContent.trim().length > 10); sentences.add(line.textContent);
    }
    assert.equal(sentences.size, GEO_ERRORS.length, language + ': each code has a different sentence');
    page.ctl.scripted.ipdata = { ok: false, error: 'something-new' }; await page.click(page.part('ipdata', '[data-geo-test]'));
    assert.equal(page.part('ipdata', '[data-geo-result]').textContent, labels.error_unknown); assert.ok(!sentences.has(labels.error_unknown));
  }
});

test('while a request is out every control is disabled and the page is busy; afterwards the focus is back on the button', async () => {
  const t = await mountPage({ controller: fakeController({ keys: { ipdata: { apiKey: 'ipdata-fixture-key' } } }) });
  const hold = t.ctl.hold('testProvider'), test = t.part('ipdata', '[data-geo-test]');
  t.ctl.scripted.ipdata = { ok: true, record: GOOGLE };
  test.focus(); test.click(); await flush();
  assert.equal(t.$('#proxy-geo-settings').getAttribute('aria-busy'), 'true'); assert.equal(t.part('ipdata', '[data-geo-result]').textContent, EN.test_running);
  assert.ok(controlsOf(t).every(node => node.disabled), 'nothing can be pressed meanwhile'); assert.equal(t.$('#pg-language').disabled, false);
  t.$('[data-geo-master]').click(); test.click(); await flush(); assert.deepEqual(t.ctl.actions(), [['testProvider', 'ipdata']], 'a second press is ignored');
  hold.release(); await flush();
  assert.equal(t.$('#proxy-geo-settings').getAttribute('aria-busy'), 'false'); assert.ok(controlsOf(t).some(node => !node.disabled));
  assert.equal(t.doc.activeElement, test, 'the disabled button lost the focus and it is given back');
  assert.match(t.part('ipdata', '[data-geo-result]').textContent, /Mountain View/);
});

test('a key typed but not saved is saved before the test; a bad one is not tested at all', async () => {
  const t = await mountPage();
  t.ctl.scripted.ipdata = { ok: true, record: GOOGLE };
  const field = t.part('ipdata', '[data-geo-field="apiKey"]');
  t.type(field, 'typed-fixture-key-1'); await t.click(t.part('ipdata', '[data-geo-test]'));
  assert.deepEqual(t.ctl.actions(), [['saveCredential', 'ipdata', { apiKey: 'typed-fixture-key-1' }], ['testProvider', 'ipdata']]);
  assert.equal(field.value, ''); assert.match(t.part('ipdata', '[data-geo-result]').textContent, /Mountain View/);
  t.type(field, 'bad'); await t.click(t.part('ipdata', '[data-geo-test]'));
  assert.deepEqual(t.ctl.actions().slice(2), [['saveCredential', 'ipdata', { apiKey: 'bad' }]], 'no request for a key that is not even well formed');
  assert.equal(t.part('ipdata', '[data-geo-result]').textContent, EN.invalid_key); assert.equal(t.doc.activeElement, field);
  const free = await mountPage(); free.ctl.scripted.ipapi = { ok: false, error: 'http-not-allowed' };
  await free.click(free.part('ipapi', '[data-geo-test]'));
  assert.deepEqual(free.ctl.actions(), [['testProvider', 'ipapi']], 'an empty optional key is not saved'); assert.equal(free.part('ipapi', '[data-geo-result]').textContent, EN.error_http_not_allowed);
});

// ---- Status line ------------------------------------------------------------------------------------------------------------------
test('the card status says idle, ok, error, the quota left and the pause, from GeoState', async () => {
  const t = await mountPage({ controller: fakeController({ keys: { ipdata: { apiKey: 'ipdata-fixture-key' } } }) });
  const status = id => t.part(id, '[data-geo-status]');
  const time = (at, tag = 'en') => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  assert.deepEqual([status('maxmind').getAttribute('data-status'), status('maxmind').textContent], ['idle', EN.status_idle_off]);
  await t.click(t.part('maxmind', '[data-geo-enabled]'));
  assert.equal(status('maxmind').textContent, EN.error_no_key, 'enabled without a key');
  await t.click(t.part('ipapi', '[data-geo-enabled]'));
  assert.equal(status('ipapi').textContent, EN.error_http_not_allowed, 'the free endpoint needs the user\'s say-so');
  await t.click(t.part('ipdata', '[data-geo-enabled]'));
  assert.equal(status('ipdata').textContent, EN.status_idle_ready);
  const at = Date.UTC(2026, 10, 6, 12, 30), later = Date.now() + 3_600_000;
  t.ctl.runtime('ipdata', { status: 'ok', okAt: at, remaining: 42 });
  await flush();
  assert.deepEqual([status('ipdata').getAttribute('data-status'), status('ipdata').textContent], ['ok', proxyGeoFill(EN.status_ok, { time: time(at) }) + ' · ' + proxyGeoFill(EN.status_remaining, { n: '42' })]);
  t.ctl.runtime('ipdata', { status: 'error', error: 'quota', pausedUntil: later });
  await flush();
  assert.equal(status('ipdata').getAttribute('data-status'), 'error');
  assert.equal(status('ipdata').textContent, [proxyGeoFill(EN.status_error, { error: EN.error_quota }), proxyGeoFill(EN.status_remaining, { n: '42' }), proxyGeoFill(EN.status_paused, { time: time(later) })].join(' · '));
  t.ctl.runtime('ipdata', { status: 'error', error: 'a code from the future', pausedUntil: Date.now() - 1000, remaining: null });
  await flush();
  assert.equal(status('ipdata').textContent, proxyGeoFill(EN.status_error, { error: EN.error_unknown }), 'an unknown code and a pause in the past');
  t.ctl.runtime('ipdata', { status: 'error', error: '<img src=x onerror=alert(1)>' });
  await flush();
  assert.equal(status('ipdata').textContent, proxyGeoFill(EN.status_error, { error: EN.error_unknown }), 'a text where a code belongs is never shown');
});

// ---- The star, the links, text safety -------------------------------------------------------------------------------------------
test('the gold star is in the MaxMind card only, has an accessible name and a caption, and is not the only signal', async () => {
  assert.deepEqual(GEO_PROVIDERS.filter(id => GEO_PROVIDER_INFO[id].recommended), ['maxmind'], 'the catalogue recommends exactly one provider');
  for (const [language, labels] of [['en', EN], ['ru', RU]]) {
    const t = await mountPage({ language });
    const stars = t.doc.querySelectorAll('[data-geo-star]');
    assert.equal(stars.length, 1); assert.ok(t.card('maxmind').contains(stars[0]));
    for (const id of GEO_PROVIDERS.filter(item => item !== 'maxmind')) assert.equal(t.part(id, '[data-geo-star]'), null, 'no star in ' + id);
    assert.equal(stars[0].getAttribute('role'), 'img'); assert.equal(stars[0].getAttribute('aria-label'), labels.recommended); assert.ok(labels.recommended.length > 4);
    assert.equal(stars[0].querySelector('svg').getAttribute('aria-hidden'), 'true'); assert.equal(stars[0].querySelector('svg').namespace, 'http://www.w3.org/2000/svg');
    assert.equal(t.part('maxmind', '.pg-star-caption').textContent, labels.recommended);
  }
  assert.equal((await mountPage()).part('maxmind', '[data-geo-star]').getAttribute('aria-label'), 'Recommended', 'the literal English name');
});

test('every card links to its own documentation in a new tab without opener; no other address is in the page', async () => {
  const t = await mountPage();
  for (const id of GEO_PROVIDERS) {
    const link = t.part(id, '[data-geo-docs]');
    assert.equal(link.getAttribute('href'), GEO_PROVIDER_INFO[id].docsUrl); assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(link.textContent, EN.docs); assert.ok(link.getAttribute('aria-label').includes(GEO_PROVIDER_INFO[id].name) && link.getAttribute('aria-label').toLowerCase().includes('documentation'));
  }
  assert.equal((await mountPage({ language: 'ru' })).part('maxmind', '[data-geo-docs]').textContent, 'Документация');
  const addresses = [];
  t.$('#proxy-geo-settings').walk(node => { for (const [name, value] of node.attributes) if (/^(?:https?:|\/\/)/i.test(value) || name === 'src') addresses.push(value); });
  assert.deepEqual(addresses.sort(), GEO_PROVIDERS.map(id => GEO_PROVIDER_INFO[id].docsUrl).sort());
  assert.equal(t.$('#proxy-geo-settings').querySelectorAll('img, iframe, script, link, form, object, embed').length, 0, 'the script builds none of these');
});

test('provider text is only ever a text node: a markup-looking country, city and name stay text', async () => {
  const t = await mountPage({ controller: fakeController({ keys: { ipdata: { apiKey: 'ipdata-fixture-key' } } }) });
  const evil = '<img src=x onerror=alert(1)>';
  t.ctl.scripted.ipdata = { ok: true, record: { ...GOOGLE, countryName: evil, city: '</div><script>alert(2)</script>', org: '"><svg onload=alert(3)>' } };
  await t.click(t.part('ipdata', '[data-geo-test]'));
  const line = t.part('ipdata', '[data-geo-result]');
  assert.ok(line.textContent.includes(evil) && line.textContent.includes('<script>alert(2)</script>') && line.textContent.includes('<svg onload=alert(3)>'));
  assert.ok(line.children.length === 0, 'plain text, no child element');
  assert.equal(t.doc.querySelectorAll('img, script[src="x"], svg[onload]').length, 0);
  t.doc.documentElement.walk(node => { for (const [name, value] of node.attributes) assert.ok(!/onerror|onload|alert\(|<img|<svg|<script/.test(value), 'no attribute carries provider text: ' + name); });
  t.ctl.scripted.ipdata = { ok: true, record: { countryName: { toString: () => { throw new Error('coerced'); } }, city: 7, org: ['x'] } };
  await t.click(t.part('ipdata', '[data-geo-test]'));
  assert.equal(t.part('ipdata', '[data-geo-result]').textContent, proxyGeoFill(EN.test_ok_empty, { ip: GEO_TEST_IP }), 'odd types are ignored, never coerced');
});

// ---- Data card -------------------------------------------------------------------------------------------------------------------
test('clearing the cache and removing all keys confirm inline: the first press arms, Escape or Cancel or a timeout or a focus change disarm', async () => {
  const t = await mountPage({ controller: fakeController({ cacheCount: 7, keys: { ipdata: { apiKey: 'ipdata-fixture-key' }, ipapi: { apiKey: 'ipapi-fixture-key' } } }) });
  const clear = t.$('[data-geo-clear-cache]'), forgetAll = t.$('[data-geo-forget-all]'), cancel = t.$('[data-geo-confirm-cancel]');
  assert.equal(clear.textContent, proxyGeoFill(EN.clear_cache, { n: 7 })); assert.equal(forgetAll.textContent, EN.forget_all); assert.equal(cancel.hidden, true);
  await t.click(clear);
  assert.deepEqual(t.ctl.actions(), [], 'one press changes nothing'); assert.equal(clear.getAttribute('data-armed'), 'true'); assert.equal(clear.textContent, proxyGeoFill(EN.clear_cache_armed, { n: 7 }));
  assert.equal(cancel.hidden, false); assert.equal(t.text('[data-geo-confirm-hint]'), EN.confirm_hint); assert.equal(forgetAll.getAttribute('data-armed'), 'false');
  clear.focus(); clear.fire('keydown', { key: 'Escape', bubbles: true });
  assert.equal(clear.getAttribute('data-armed'), 'false'); assert.equal(cancel.hidden, true); assert.equal(t.text('[data-geo-confirm-hint]'), ''); assert.equal(t.doc.activeElement, clear);
  await t.click(forgetAll); assert.equal(forgetAll.textContent, EN.forget_all_armed);
  await t.click(cancel); assert.equal(forgetAll.getAttribute('data-armed'), 'false'); assert.deepEqual(t.ctl.actions(), []);
  await t.click(forgetAll); assert.equal(t.env.timers.size, 1, 'one expiry timer'); t.env.tick(); assert.equal(forgetAll.getAttribute('data-armed'), 'false'); assert.equal(t.env.timers.size, 0);
  await t.click(forgetAll); t.part('ipdata', '[data-geo-field="apiKey"]').focus(); assert.equal(forgetAll.getAttribute('data-armed'), 'false', 'leaving the data card disarms');
  await t.click(forgetAll); await t.click(clear); assert.equal(clear.getAttribute('data-armed'), 'true'); assert.equal(forgetAll.getAttribute('data-armed'), 'false', 'arming one disarms the other');
  await t.click(t.part('ipdata', '[data-geo-enabled]')); assert.equal(clear.getAttribute('data-armed'), 'false', 'any other action disarms');
  await t.click(clear); await t.click(clear);
  assert.deepEqual(t.ctl.actions().slice(1), [['clearCache']]); assert.equal(clear.textContent, proxyGeoFill(EN.clear_cache, { n: 0 })); assert.equal(clear.disabled, true);
  assert.equal(t.text('[data-geo-data-note]'), EN.done_cache);
  await t.click(forgetAll); await t.click(forgetAll);
  assert.deepEqual(t.ctl.actions().slice(2), [['forgetAllCredentials']]); assert.equal(t.text('[data-geo-data-note]'), EN.done_forget_all);
  assert.ok(t.doc.querySelectorAll('[data-geo-key]').every(node => node.getAttribute('data-has') === 'false')); assert.equal(forgetAll.disabled, true);
  assert.notEqual(t.doc.activeElement, t.doc.body, 'the focus is not lost with the disabled button');
});

// ---- Changes from elsewhere, failures, language, lifecycle -----------------------------------------------------------------------
test('a change made in another tab is shown without touching what is being typed or where the focus is', async () => {
  const t = await mountPage();
  const field = t.part('ipdata', '[data-geo-field="apiKey"]');
  t.type(field, 'half-typed-key'); field.focus();
  t.ctl.external({ settings: { enabled: true, providers: { ipdata: { enabled: true } } }, cacheCount: 3 }); await flush();
  assert.equal(t.$('[data-geo-master]').getAttribute('aria-checked'), 'true'); assert.equal(t.part('ipdata', '[data-geo-enabled]').getAttribute('aria-checked'), 'true');
  assert.equal(t.$('[data-geo-clear-cache]').textContent, proxyGeoFill(EN.clear_cache, { n: 3 }));
  assert.equal(field.value, 'half-typed-key'); assert.equal(t.doc.activeElement, field);
});

test('a controller that cannot load, or a refused or failing change, shows one alert and leaves the page usable', async () => {
  const unloaded = fakeController({ loaded: false }); unloaded.load = async () => unloaded.getState();
  const a = await mountPage({ controller: unloaded });
  assert.equal(a.$('[data-geo-message]').hidden, false); assert.equal(a.text('[data-geo-message]'), EN.err_load);
  const rejected = fakeController({ loaded: false }); rejected.load = async () => { throw new Error('storage'); };
  assert.equal((await mountPage({ controller: rejected })).text('[data-geo-message]'), EN.err_load);
  const t = await mountPage();
  assert.equal(t.$('[data-geo-message]').hidden, true);
  t.ctl.broken.add('setEnabled'); await t.click('[data-geo-master]');
  assert.equal(t.$('[data-geo-message]').hidden, false); assert.equal(t.text('[data-geo-message]'), EN.err_save); assert.equal(t.$('[data-geo-master]').getAttribute('aria-checked'), 'false');
  assert.equal(t.$('[data-geo-master]').disabled, false, 'usable again'); t.ctl.broken.clear();
  await t.click('[data-geo-master]'); assert.equal(t.$('[data-geo-message]').hidden, true, 'the next attempt clears the alert'); assert.equal(t.$('[data-geo-master]').getAttribute('aria-checked'), 'true');
  const refusing = fakeController(); refusing.setOption = async () => ({ ok: false, error: 'storage-unavailable' });
  const r = await mountPage({ controller: refusing }); await r.click('[data-geo-option="remember"]');
  assert.equal(r.text('[data-geo-message]'), EN.err_save);
});

test('language: the browser language, the saved choice, the selector and another tab; variants and unknown languages end in English; RTL mirrors', async () => {
  const options = (await mountPage()).doc.querySelectorAll('#pg-language option');
  assert.deepEqual(options.map(node => node.getAttribute('value')), LANGUAGES.map(language => language.id));
  assert.deepEqual([...LANGUAGES.map(language => language.id)].sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  const de = await mountPage({ language: 'de-AT' });
  assert.equal(de.doc.documentElement.lang, 'de'); assert.equal(de.text('#pg-master-title'), PROXY_GEO_SETTINGS_MESSAGES.de.master_title, 'a variant reads the table of its language'); assert.notEqual(PROXY_GEO_SETTINGS_MESSAGES.de.master_title, EN.master_title);
  const ru = await mountPage({ language: 'ru-RU' });
  assert.equal(ru.doc.documentElement.lang, 'ru'); assert.equal(ru.doc.documentElement.dir, 'ltr'); assert.equal(ru.doc.title, 'Proxy Manager Geolocation API · Detect.Expert');
  assert.equal(ru.text('#pg-master-title'), RU.master_title); assert.equal(ru.text('.pg-eyebrow'), RU.eyebrow); assert.equal(ru.text('.pg-back'), RU.back);
  assert.equal((await mountPage({ language: 'zz' })).doc.documentElement.lang, 'en');
  const saved = await mountPage({ language: 'en', stored: { 'ui-language-v1': 'ar' } });
  assert.equal(saved.doc.documentElement.lang, 'ar'); assert.equal(saved.doc.documentElement.dir, 'rtl'); assert.equal(saved.$('#pg-language').value, 'ar');
  assert.equal(saved.text('#pg-master-title'), PROXY_GEO_SETTINGS_MESSAGES.ar.master_title, 'Arabic reads its own table'); assert.notEqual(PROXY_GEO_SETTINGS_MESSAGES.ar.master_title, EN.master_title);
  assert.equal((await mountPage({ language: 'ur' })).doc.documentElement.dir, 'rtl');
  const t = await mountPage({ language: 'en' });
  t.$('#pg-language').value = 'ru'; t.$('#pg-language').fire('change'); await flush();
  assert.deepEqual(t.api.writes, [{ 'ui-language-v1': 'ru' }]); assert.equal(t.text('#pg-master-title'), RU.master_title); assert.equal(t.text('[data-geo-state]'), RU.state_off);
  assert.equal(t.part('maxmind', '[data-geo-star]').getAttribute('aria-label'), RU.recommended); assert.equal(t.part('ipapi', '[data-geo-docs]').getAttribute('aria-label'), proxyGeoFill(RU.docs_aria, { name: 'ip-api.com' }));
  assert.equal(t.part('maxmind', '[data-geo-field="accountId"]').parentNode.textContent.trim(), RU.field_accountId);
  assert.equal(t.$('[data-geo-clear-cache]').textContent, proxyGeoFill(RU.clear_cache, { n: 0 }));
  for (const handler of [...t.api.handlers]) handler({ 'ui-language-v1': { newValue: 'en' } }, 'local');
  assert.equal(t.text('#pg-master-title'), EN.master_title, 'another tab changes the language here'); assert.equal(t.$('#pg-language').value, 'en');
  for (const handler of [...t.api.handlers]) handler({ 'other-key': { newValue: 'ru' } }, 'local');
  for (const handler of [...t.api.handlers]) handler({ 'ui-language-v1': { newValue: 'ru' } }, 'session');
  assert.equal(t.text('#pg-master-title'), EN.master_title, 'only the local language key counts');
});

test('the theme is started once and its failure does not matter; the page works without a root, an API or a theme', async () => {
  let started = 0;
  await mountPage({ theme: () => { started++; return Promise.reject(new Error('no theme')); } });
  assert.equal(started, 1);
  await mountPage({ theme: () => { throw new Error('sync failure'); } });
  assert.equal(mountProxyGeoSettings({ document: new FakeDocument(), api: fakeApi(), env: fakeEnv(), controller: fakeController(), theme: null }), null, 'no root, no page');
  assert.equal(mountProxyGeoSettings({ document: parseHtml(HTML), api: {}, env: fakeEnv(), controller: fakeController() }), null, 'not an extension page');
  const t = await mountPage({ theme: null }); assert.equal(t.text('[data-geo-state]'), EN.state_off);
});

test('closing the page clears the typed keys, unsubscribes, stops listening and disposes only a controller it created', async () => {
  const t = await mountPage();
  const field = t.part('ipdata', '[data-geo-field="apiKey"]'); t.type(field, 'typed-then-closed-key');
  assert.equal(t.api.handlers.size, 1); assert.ok(t.env.events.has('pagehide'));
  t.env.events.get('pagehide')();
  assert.equal(field.value, ''); assert.equal(t.api.handlers.size, 0); assert.equal(t.env.events.has('pagehide'), false);
  t.ctl.external({ settings: { enabled: true } }); await flush();
  assert.equal(t.$('[data-geo-master]').getAttribute('aria-checked'), 'false', 'no rendering after dispose');
  assert.deepEqual(t.ctl.calls.filter(call => call[0] === 'dispose'), [], 'an injected controller belongs to whoever injected it');
  t.page.dispose();
  await t.click(t.$('[data-geo-master]')); assert.deepEqual(t.ctl.actions(), [], 'a closed page makes no change');
});

test('the labels used by the page exist in both languages and every key the script reads is defined', () => {
  const script = read('proxy-geo-settings.js');
  const used = new Set([...script.matchAll(/'((?:[a-z]+_)+[a-zA-Z_]*[a-zA-Z])'/g)].map(match => match[1]).filter(key => key in EN));
  for (const key of ['title', 'state_ready', 'clear_cache_armed', 'result_saved', 'invalid_maxmind', 'test_ok', 'status_paused', 'recommended', 'docs_aria']) assert.ok(used.has(key) || key in EN, key);
  for (const key of Object.keys(EN)) assert.equal(typeof RU[key], 'string', 'ru has ' + key);
  assert.ok(PRODUCTION_LANGUAGES.length === 21);
});

// ---- Command palette -------------------------------------------------------------------------------------------------------------
test('command palette: one extra Integrations entry when the page can be opened and none for an older caller; English words find it in any language', () => {
  const calls = [];
  const make = (locale, extra = {}) => buildPaletteEntries({ h: (type, props) => ({ type, props }), icon: section => ({ section }), locale, labels: redesignLabels(locale), sectionLabel: section => 'section:' + section,
    translate: key => 'tr:' + key, groupLabel: section => 'group:' + section, choose: section => calls.push(['choose', section]), openAntidetect: () => {}, openPrecursor: () => calls.push(['precursor']), ...extra });
  const older = make('en'), current = make('en', { openProxyGeo: () => calls.push(['geo']) });
  assert.ok(!older.some(item => item.id === 'proxy-geo'), 'an older caller gets the old list');
  assert.deepEqual(current.map(item => item.id).filter(id => !older.some(item => item.id === id)), ['proxy-geo']);
  assert.equal(current.findIndex(item => item.id === 'proxy-geo'), current.findIndex(item => item.id === 'precursor') + 1, 'right after the Precursor entry');
  for (const locale of ['en', 'ru', 'ar']) {
    const entry = make(locale, { openProxyGeo: () => calls.push(['geo']) }).find(item => item.id === 'proxy-geo');
    assert.equal(entry.label, 'Proxy Manager Geolocation API'); assert.equal(entry.group, redesignLabels(locale).integrations); assert.match(entry.keywords, /geolocation.*Proxy.*Integrations/);
  }
  const ru = make('ru', { openProxyGeo: () => calls.push(['geo']) });
  assert.equal(rankPaletteEntries(ru, 'geolocation')[0].id, 'proxy-geo'); assert.equal(rankPaletteEntries(ru, 'geoip')[0].id, 'proxy-geo');
  assert.equal(rankPaletteEntries(ru, 'precursor')[0].id, 'precursor', 'the old entry is still found first for its own name');
  rankPaletteEntries(ru, 'geolocation')[0].run(); assert.deepEqual(calls, [['geo']]);
});
