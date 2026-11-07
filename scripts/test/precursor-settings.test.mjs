// ADR-076: own-page channel, stale replies, physical bounds and complete local copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPrecursorSettingsClient, precursorSettingsLocale, precursorSettingsDisplayState, mountPrecursorSettings } from '../../apps/production-extension/precursor-settings.js';
import { PRECURSOR_MODES_MESSAGES, PRECURSOR_MODES_KEYS, applyPrecursorModesCopy, precursorSettingsLocaleSource } from '../production-locales-precursor-modes.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const zoneId = 'a'.repeat(32);
const state = patch => ({ status: 'disconnected', zone: null, mode: 'unknown', checkedAt: null, lastKnownMode: 'unknown', lastKnownAt: null, errorCode: null, history: [], notifications: false, connected: false, ...patch });
const ready = () => state({ status: 'ready', zone: { id: zoneId, name: 'example.com' }, mode: 'monitor', checkedAt: 100, lastKnownMode: 'monitor', lastKnownAt: 100, connected: true });
function event() { const listeners = new Set(); return { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback), fire(value) { for (const callback of listeners) callback(value); } }; }
function harness(patch = {}) {
  const posts = [], snapshots = [], working = [], lost = [], self = {}, ports = [];
  const env = { location: { href: 'chrome-extension://own/precursor-settings.html' }, top: self, self, document: { visibilityState: 'visible' }, ...patch };
  const api = { runtime: { getURL: path => 'chrome-extension://own/' + path, connect() { const port = { onMessage: event(), onDisconnect: event(), postMessage(value) { posts.push(structuredClone(value)); }, disconnect() { port.onDisconnect.fire(); } }; ports.push(port); return port; } } };
  const client = createPrecursorSettingsClient(api, { env, deadline: 100, onState: value => snapshots.push(value), onBusy: value => working.push(value), onLost: () => lost.push(true) });
  const reply = (id, snapshot = ready(), patch = {}) => ports.at(-1).onMessage.fire({ schemaVersion: 1, id, ok: true, state: snapshot, errorCode: null, ...patch });
  return { client, posts, snapshots, working, lost, ports, reply, env, api };
}

test('settings channel rejects foreign extension, embedded page, query, fragment and hidden commands', async () => {
  for (const patch of [{ location: { href: 'chrome-extension://foreign/precursor-settings.html' } }, { location: { href: 'moz-extension://own/precursor-settings.html' } }, { location: { href: 'chrome-extension://own/precursor-settings.html?token=x' } }, { location: { href: 'chrome-extension://own/precursor-settings.html#x' } }, { top: {} }, { document: { visibilityState: 'hidden' } }]) {
    const h = harness(patch); await assert.rejects(h.client.request('read'), { code: 'unauthorized' }); assert.equal(h.posts.length, 0); h.client.dispose();
  }
});

test('connect uses strict canonical command and accepts an opaque visible-ASCII token', async () => {
  const h = harness();
  try {
    const pending = h.client.request('connect', { zoneId: zoneId.toUpperCase(), token: 'fixture-token_01' });
    assert.deepEqual(h.posts[0], { schemaVersion: 1, id: 1, action: 'connect', zoneId, token: 'fixture-token_01' });
    h.reply(1); assert.deepEqual(await pending, ready());
    assert.ok(h.snapshots.every(value => !Object.hasOwn(value, 'token')));
    await assert.rejects(h.client.request('connect', { zoneId, token: 'space not allowed' }), { code: 'invalid-input' });
    assert.equal(h.posts.length, 1);
  } finally { h.client.dispose(); }
});

test('wrong IDs and malformed reply states cannot complete or update a pending request', async () => {
  const h = harness();
  try {
    const pending = h.client.request('read'); h.reply(33); h.reply(1, { ...ready(), token: 'injected' });
    assert.equal(h.client.isBusy(), true); assert.equal(h.snapshots.length, 0);
    h.reply(1); await pending; assert.equal(h.client.isBusy(), false); assert.equal(h.snapshots.length, 1);
    h.reply(1, state()); assert.equal(h.snapshots.length, 1);
  } finally { h.client.dispose(); }
});

test('display timeout retains one request slot; explicit disconnect cancels it and rejects late replies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const h = harness();
  try {
    const first = h.client.request('read'), timedOut = assert.rejects(first, { code: 'timeout' }); t.mock.timers.tick(101); await timedOut;
    assert.equal(h.client.isBusy(), true); await assert.rejects(h.client.request('refresh'), { code: 'busy' }); assert.equal(h.posts.length, 1);
    const stop = h.client.request('disconnect'); h.reply(1); assert.equal(h.snapshots.length, 0); assert.equal(h.client.isBusy(), true);
    h.ports[0].onMessage.fire({ schemaVersion: 1, type: 'state', state: ready() }); assert.equal(h.snapshots.length, 0);
    h.reply(2, state()); await stop; assert.equal(h.client.isBusy(), false); assert.equal(h.snapshots[0].connected, false);
  } finally { h.client.dispose(); }
});

test('disconnect and disposal invalidate old ports and do not resurrect old state', async () => {
  const h = harness();
  const first = h.client.request('read'), failed = assert.rejects(first, { code: 'disconnected' });
  h.ports[0].disconnect(); await failed; assert.equal(h.lost.length, 1);
  const second = h.client.request('read'); h.ports[0].onMessage.fire({ schemaVersion: 1, type: 'state', state: ready() }); assert.equal(h.snapshots.length, 0);
  h.reply(2); await second; h.client.dispose();
  h.ports[1].onMessage.fire({ schemaVersion: 1, type: 'state', state: state() }); assert.equal(h.snapshots.length, 1);
  await assert.rejects(h.client.request('read'), { code: 'unauthorized' });
});

test('a timed-out reply and its pending pushes cannot restore the previous known mode', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const h = harness();
  try {
    const pending = h.client.request('read'), failed = assert.rejects(pending, { code: 'timeout' }); t.mock.timers.tick(101); await failed;
    h.ports[0].onMessage.fire({ schemaVersion: 1, type: 'state', state: ready() }); assert.equal(h.snapshots.length, 0); assert.equal(h.client.isBusy(), true);
    h.reply(1); assert.equal(h.snapshots.length, 0); assert.equal(h.client.isBusy(), false);
    const fresh = h.client.request('read'); h.reply(2); await fresh; assert.equal(h.snapshots.length, 1);
  } finally { h.client.dispose(); }
});

test('local display expires known values and backwards clocks without losing last confirmed facts', () => {
  const original = ready();
  assert.equal(precursorSettingsDisplayState(original, 100 + 180000), original);
  const expired = precursorSettingsDisplayState(original, 100 + 180001);
  assert.equal(expired.mode, 'unknown'); assert.equal(expired.status, 'stale'); assert.equal(expired.connected, true); assert.equal(expired.lastKnownMode, 'monitor'); assert.equal(expired.lastKnownAt, 100); assert.equal(original.mode, 'monitor');
  const backwards = precursorSettingsDisplayState(original, 99); assert.equal(backwards.mode, 'unknown'); assert.equal(backwards.errorCode, 'clock-changed');
  assert.equal(precursorSettingsDisplayState(backwards, 101), backwards, 'clock recovery alone cannot reinstate a known value');
  const timeout = precursorSettingsDisplayState(original, 105, { timedOut: true }); assert.equal(timeout.mode, 'unknown'); assert.equal(timeout.status, 'stale'); assert.equal(timeout.errorCode, 'timeout'); assert.equal(timeout.connected, true);
  const off = precursorSettingsDisplayState({ ...original, mode: 'off', lastKnownMode: 'off' }, 100 + 180001); assert.equal(off.mode, 'unknown'); assert.equal(off.lastKnownMode, 'off');
});

test('settings owns exactly one visible freshness timer and clears it and token on hide/dispose', async () => {
  function element() {
    const attributes = new Map(), events = new Map();
    return { value: '', dataset: {}, textContent: '', hidden: false, disabled: false, append() {}, replaceChildren() {}, querySelectorAll: () => [],
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
      addEventListener: (key, listener) => events.set(key, listener), removeEventListener: key => events.delete(key), fire: key => events.get(key)?.() };
  }
  const ids = ['precursor-settings', ...['form','zone-id','token','connect','disconnect','refresh','notifications','message','status','mode','zone','checked','last-known-row','last-known','history-count','empty','history-table','history-body','language'].map(id => 'pm-' + id)];
  const elements = new Map(ids.map(id => [id, element()])), doc = { ...element(), visibilityState: 'visible', documentElement: {}, getElementById: id => elements.get(id), createDocumentFragment: element, createElement: element };
  const intervals = new Map(); let sequence = 0;
  const h = harness({ document: doc, setInterval(callback, delay) { assert.equal(delay, 1000); const id = ++sequence; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); }, addEventListener() {}, removeEventListener() {} });
  h.api.i18n = { getUILanguage: () => 'en' }; h.api.storage = { local: { get: async () => ({}), set: async () => {} }, onChanged: event() };
  const ui = mountPrecursorSettings({ document: doc, api: h.api, env: h.env });
  assert.equal(intervals.size, 1); h.reply(1, state()); await Promise.resolve(); await Promise.resolve();
  elements.get('pm-token').value = 'temporary-fixture'; doc.visibilityState = 'hidden'; doc.fire('visibilitychange');
  assert.equal(intervals.size, 0); assert.equal(elements.get('pm-token').value, '');
  doc.visibilityState = 'visible'; doc.fire('visibilitychange'); doc.fire('visibilitychange'); assert.equal(intervals.size, 1);
  elements.get('pm-token').value = 'temporary-fixture'; ui.dispose(); assert.equal(intervals.size, 0); assert.equal(elements.get('pm-token').value, '');
  doc.fire('visibilitychange'); assert.equal(intervals.size, 0); h.client.dispose(); await Promise.resolve();
});

test('all 21 locale catalogs and generated own-page module are complete and deterministic', () => {
  assert.deepEqual(Object.keys(PRECURSOR_MODES_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  const html = readFileSync(new URL('../../apps/production-extension/precursor-settings.html', import.meta.url), 'utf8');
  const used = [...html.matchAll(/data-i18n="([a-z_]+)"/g)].map(match => 'precursor_modes_' + match[1]);
  for (const language of PRODUCTION_LANGUAGES) {
    const table = applyPrecursorModesCopy({}, language.id);
    assert.deepEqual(Object.keys(table).sort(), [...PRECURSOR_MODES_KEYS].sort());
    for (const key of [...used, 'precursor_modes_zone_mode', 'precursor_modes_mode_unknown', 'precursor_modes_notification_title', 'precursor_modes_notification_body']) assert.ok(table[key].message.trim(), language.id + '/' + key);
    assert.match(table.precursor_modes_notification_body.message, /\$1/); assert.match(table.precursor_modes_notification_body.message, /\$2/); assert.match(table.precursor_modes_notification_body.message, /\$3/);
    assert.equal(precursorSettingsLocale(language.id), language.id);
  }
  assert.equal(readFileSync(new URL('../../apps/production-extension/precursor-settings-locales.js', import.meta.url), 'utf8'), precursorSettingsLocaleSource());
  assert.equal(precursorSettingsLocale('zh-TW'), 'zh_CN'); assert.equal(precursorSettingsLocale('pt-PT'), 'pt_BR'); assert.equal(precursorSettingsLocale('zz'), 'en');
  assert.equal(PRECURSOR_MODES_MESSAGES.ru.precursor_modes_zone_mode, 'Режим зоны'); assert.equal(PRECURSOR_MODES_MESSAGES.en.precursor_modes_zone_mode, 'Zone mode');
  assert.equal(PRECURSOR_MODES_MESSAGES.ar.precursor_modes_notification_body, '$1: من $2 إلى $3');
  assert.equal(PRECURSOR_MODES_MESSAGES.ur.precursor_modes_notification_body, '$1: $2 سے $3 تک');
  for (const locale of ['ar', 'ur']) assert.doesNotMatch(PRECURSOR_MODES_MESSAGES[locale].precursor_modes_notification_body, /[←→]/, 'native notification transition must remain unambiguous for Latin mode substitutions');
  assert.match(PRECURSOR_MODES_MESSAGES.en.precursor_modes_token_help, /browser session memory/); assert.doesNotMatch(PRECURSOR_MODES_MESSAGES.en.precursor_modes_token_help, /background restart/);
});
