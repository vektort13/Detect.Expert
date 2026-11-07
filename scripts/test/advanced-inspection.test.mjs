import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { decodeBeacon } from '../../apps/production-extension/beacon-decoder.js';
import { readBeaconSnapshot } from '../../packages/contracts/src/beacons.mjs';
import { emptyBackgroundInventory } from '../../apps/production-extension/background-activity-observer.js';
import { readBackgroundSnapshot } from '../../packages/contracts/src/background-activity.mjs';
import { readCookieProbeSnapshot } from '../../packages/contracts/src/cookie-probe.mjs';
import { captureAdvancedChannels, retainCookieProbe } from '../../apps/production-extension/pro-advanced-capture.js';
import { createAdvancedUi } from '../../apps/production-extension/advanced-ui.js';
import { ADVANCED_COPY } from '../production-advanced-copy.mjs';

const documentKey = '42:0:document';
const request = { schemaVersion: 1, type: 'ui-get-cookies', tabId: 42, frameId: 0, documentKey };
function beacon(key = documentKey) {
  const projected = decodeBeacon({ url: 'https://www.facebook.com/tr/?ev=Purchase&cd[value]=49.99&cd[currency]=EUR&ud[em]=' + 'f'.repeat(64) + '&fbp=PRIVATE_BEACON_CANARY', method: 'GET' });
  const row = { ...projected, method: 'GET', requestType: 'image', count: 2, completedCount: 1, failedCount: 1, redirectCount: 0, statusCodes: [200, 404], evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: 'example.com', script: null };
  return readBeaconSnapshot({ schemaVersion: 1, type: 'beacons-state', documentKey: key, coverageState: 'partial', requestCount: 2, rows: [row], scriptCalls: [{ ...row, count: 1, completedCount: 0, failedCount: 0, statusCodes: [], evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: 'example.com', pathTemplate: '/main.js' } }], truncated: false });
}
function background(key = documentKey, checked = true) {
  return readBackgroundSnapshot({ schemaVersion: 1, type: 'background-activity-state', documentKey: key, coverageState: 'partial', observedAt: 1000, rows: [], truncated: false, inventory: { ...emptyBackgroundInventory(), status: checked ? 'available' : 'unavailable', checkedAt: checked ? 1000 : 0, secureContext: true, supported: { serviceWorker: true, push: true, sync: true, periodicSync: true }, permissions: { notifications: 'prompt', push: 'prompt', sync: 'granted', periodicSync: 'denied' }, registrationCount: checked ? 0 : null, pushSubscriptionCount: checked ? 0 : null, syncTagCount: checked ? 0 : null, periodicTagCount: checked ? 0 : null } });
}
function probe(key = documentKey) {
  return readCookieProbeSnapshot({ schemaVersion: 1, type: 'cookie-probe-state', documentKey: key, status: 'complete', result: 'restored-same', reason: 'none', cookieName: '_ga', domain: 'example.com', owner: 'Google', removalConfirmed: true, observedRestorations: 1, source: 'unknown', cleanup: 'not-needed', startedAt: 1000, completedAt: 2000, windowMs: 10000, matchedStores: [{ storage: 'indexedDB', count: 1 }], storageCoverage: 'partial' });
}
const h = (type, props) => ({ type, props });
function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object') return text(value.props?.children);
  return value === null || value === undefined || value === false ? '' : String(value);
}
function nodes(value, predicate) {
  if (Array.isArray(value)) return value.flatMap(item => nodes(item, predicate));
  if (!value || typeof value !== 'object') return [];
  return [...(predicate(value) ? [value] : []), ...nodes(value.props?.children, predicate)];
}
const english = JSON.parse(readFileSync(new URL('../../apps/production-extension/_locales/en/messages.json', import.meta.url), 'utf8'));
const translate = (key, substitutions = []) => {
  let output = ADVANCED_COPY[key]?.[0] ?? english[key]?.message ?? key;
  for (const [name, placeholder] of Object.entries(english[key]?.placeholders ?? {})) output = output.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
  return output.replaceAll('$COUNT$', substitutions[0] ?? '');
};
const ui = createAdvancedUi({ h, useState: initial => [initial, () => {}], useEffect() {}, useRef: value => ({ current: value }), useLocale: () => 'en', translate });

test('Pro accepts old pages and the canonical metadata of all three features', () => {
  assert.equal(readAdvancedPageFields({ tabId: 42, documentKey }), true);
  assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, beacons: [beacon()], backgroundActivity: [background()], cookieProbes: [probe()] }), true);
});
for (const [field, state] of [['beacons', beacon], ['backgroundActivity', background], ['cookieProbes', probe]]) {
  test('Pro rejects private/foreign metadata in ' + field, () => {
    const valid = state(); assert.ok(valid);
    assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, [field]: [{ ...valid, value: 'PRIVATE_VALUE_CANARY' }] }), false);
    assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, [field]: [state('43:0:other')] }), false);
    assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, [field]: [valid, valid] }), false);
    let reads = 0;
    assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, get [field]() { ++reads; return [valid]; } }), false);
    assert.equal(reads, 0);
  });
}
test('Cookie experiment result is tied to the root page rather than a child document', () => {
  assert.equal(readAdvancedPageFields({ tabId: 42, documentKey, cookieProbes: [probe('42:1:child')] }), false);
});
test('Beacon UI keeps native requests and script calls separate and reveals only fixed field presence', () => {
  const state = beacon(); assert.ok(state);
  const output = text(expand(ui.BeaconRows({ state })));
  for (const expected of ['Meta', 'Purchase', '49.99', 'EUR', 'Hashed email field', 'Present', 'Network requests', 'Page calls and scripts', 'example.com/main.js', '200, 404']) assert.ok(output.includes(expected), expected);
  for (const excluded of ['PRIVATE_BEACON_CANARY', 'ffffffffffffffff', 'received by server', 'GTM loaded this hit']) assert.equal(output.includes(excluded), false, excluded);
  assert.equal(state.requestCount, 2);
});
test('An unread background inventory is shown as unchecked, rather than falsely unsupported', () => {
  const state = background(documentKey, false); assert.ok(state);
  const output = text(expand(ui.BackgroundRows({ state })));
  assert.ok(output.includes('Not checked yet'));
  assert.equal(output.includes('Unsupported'), false);
});

test('An inaccessible isolated inventory preserves page calls without a false browser capability verdict', () => {
  const state = background();
  state.inventory = { ...emptyBackgroundInventory(), status: 'unsupported', checkedAt: 1000, secureContext: true };
  state.rows = [{ operation: 'ServiceWorkerContainer.register', phase: 'async-returned', count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: 'example.com', pathTemplate: '/main.js' }, worker: { host: 'example.com', pathTemplate: '/sw.js' } }];
  assert.ok(readBackgroundSnapshot(state));
  const rendered = expand(ui.BackgroundRows({ state })), output = text(rendered);
  assert.ok(output.includes('Data unavailable'));
  assert.ok(output.includes('ServiceWorkerContainer.register'));
  assert.ok(output.includes('example.com/sw.js'));
  assert.equal(output.includes('Unsupported'), false);
  assert.equal(JSON.stringify(rendered).includes('data-background-capability'), false);
  assert.equal(JSON.stringify(rendered).includes('data-background-inventory-unavailable'), true);
});
test('A page-call-only beacon snapshot still displays the initiating script', () => {
  const state = { ...beacon(), rows: [], requestCount: 0 };
  assert.ok(readBeaconSnapshot(state));
  const output = text(expand(ui.BeaconPanel({ beacons: { state, pending: false, eligible: true, refresh() {} } })));
  assert.ok(output.includes('example.com/main.js'));
  assert.equal(output.includes('No known beacons recorded'), false);
});
test('Cookie correlation is displayed as a match, without a claimed restoration source', () => {
  const output = text(expand(ui.CookieProbeResult({ state: probe() })));
  assert.ok(output.includes('The site restored the original cookie value'));
  assert.ok(output.includes('Matching values in storage'));
  assert.ok(output.includes('indexedDB: 1'));
  assert.equal(/restored from|TPM|cannot be exported|PRIVATE_/.test(output), false);
});
test('Pro preview renders all canonical feature rows and rejects a contaminated snapshot', () => {
  const activity = { ...background(), rows: [{ operation: 'ServiceWorkerContainer.register', count: 1, phase: 'async-returned', evidenceSource: 'page-hook', integrity: 'page-controlled', script: { host: 'example.com', pathTemplate: '/main.js' }, worker: { host: 'example.com', pathTemplate: '/sw.js' }, attributionConfidence: 'exact-resource' }] };
  const page = { beacons: [beacon()], backgroundActivity: [activity], cookieProbes: [probe()] };
  const output = text(expand(ui.ProAdvancedSnapshot({ page })));
  assert.ok(output.includes('Purchase') && output.includes('Background activity') && output.includes('Cookie restoration test'));
  assert.equal(ui.ProAdvancedSnapshot({ page: { ...page, cookieProbes: [{ ...probe(), handle: 'a'.repeat(32) }] } }), null);
});

test('Empty Pro advanced snapshots create no headings, unknown cards or zero inventories', () => {
  const emptyBeacon = { ...beacon(), requestCount: 0, rows: [], scriptCalls: [] };
  assert.equal(ui.ProAdvancedSnapshot({ page: {} }), null);
  assert.equal(ui.ProAdvancedSnapshot({ page: { beacons: [emptyBeacon], backgroundActivity: [background()] } }), null);
  assert.equal(ui.ProAdvancedSnapshot({ page: { beacons: [emptyBeacon], backgroundActivity: [background(documentKey, false)] } }), null);
  const trimmed = expand(ui.ProAdvancedSnapshot({ page: { beacons: [{ ...emptyBeacon, truncated: true }] } }));
  assert.equal(nodes(trimmed, node => node.props['data-pro-advanced-truncated']).length, 1);
  assert.equal(nodes(trimmed, node => node.type === 'table').length, 0);
});

test('Pro beacon tables retain browser attempts, script calls, every money value, logos and document hosts', () => {
  const first = beacon(), second = beacon('42:1:child');
  first.rows[0].money.push({ purpose: 'value', value: '17.25', currency: 'USD', event: 'Purchase' });
  second.scriptCalls[0].count = 91;
  const output = expand(ui.ProAdvancedSnapshot({ page: { beacons: [first, { ...beacon('42:2:empty'), rows: [], scriptCalls: [], requestCount: 0 }, second], reports: [
    { documentKey, host: 'shop.example.com' }, { documentKey: '42:1:child', host: 'frame.example.com' }
  ] } }));
  const rows = nodes(output, node => node.props['data-beacon-row'] !== undefined);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.props['data-beacon-source']), ['browser-network', 'page-hook', 'browser-network', 'page-hook']);
  assert.equal(nodes(output, node => node.type === 'table').length, 1);
  assert.equal(nodes(output, node => node.props['data-company-logo']).length, 4);
  for (const value of ['49.99', 'EUR', '17.25', 'USD', '91', 'example.com/main.js', 'shop.example.com', 'frame.example.com']) assert.ok(text(output).includes(value), value);
  assert.equal(text(output).includes('PRIVATE_BEACON_CANARY'), false);
  assert.equal(nodes(output, node => node.props.class === 'advanced-card').length, 0);
});

test('Pro background tables preserve observed calls when inventory access is unavailable', () => {
  const state = background();
  state.inventory = { ...emptyBackgroundInventory(), status: 'unsupported', checkedAt: 1000, secureContext: true };
  state.rows = ['async-returned', 'threw-sync'].map(phase => ({ operation: 'ServiceWorkerContainer.register', phase, count: phase === 'async-returned' ? 9 : 2, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: 'example.com', pathTemplate: '/main.js' }, worker: { host: 'example.com', pathTemplate: '/sw.js' } }));
  const output = expand(ui.ProAdvancedSnapshot({ page: { backgroundActivity: [state], reports: [{ documentKey, host: 'example.com' }] } }));
  assert.equal(nodes(output, node => node.props['data-background-row'] !== undefined).length, 2);
  assert.equal(nodes(output, node => node.props['data-background-capability']).length, 0);
  assert.equal(nodes(output, node => node.type === 'table').length, 1);
  for (const value of ['ServiceWorkerContainer.register', 'example.com/sw.js', '9', '2']) assert.ok(text(output).includes(value));
});

function setup() {
  const page = { id: 'page', tabId: 42, documentKey, endedAt: null }, writes = [], sizes = new Map(); let current = true;
  const runtime = { state: { reports: new Map() }, scope: { hasDataConsent: true }, canObserveNetworkDocument: () => current, getProjection: () => ({ documentKey, coverageState: 'partial' }), beacons: { read: async () => beacon() }, backgroundActivity: { read: async () => background() }, cookieProbe: { snapshot: () => probe() } };
  const pro = { runtime, pageFor: () => page, pageById: () => page, checkDeadline: () => true, belongsToPage: () => false, size: (key, bytes) => { sizes.set(key, bytes); return true; }, mark() {}, async flush() { writes.push(JSON.stringify(page)); } };
  return { page, runtime, pro, writes, sizes, context: { current: () => current }, invalidate: () => { current = false; } };
}
test('Pro captures all channels in one owned scheduler job, refreshes inventory once, and never retains raw canaries', async () => {
  const state = setup(), types = [], inventory = new Set();
  state.runtime.backgroundActivity.read = async request => { types.push(request.type); return background(); };
  await captureAdvancedChannels(state.pro, state.page, request, state.context, inventory);
  await captureAdvancedChannels(state.pro, state.page, request, state.context, inventory);
  assert.deepEqual(types, ['ui-refresh-background-activity', 'ui-get-background-activity']);
  assert.equal(state.page.beacons.length, 1); assert.equal(state.page.backgroundActivity.length, 1); assert.equal(state.page.cookieProbes.length, 1);
  assert.equal(state.writes.join().includes('PRIVATE_BEACON_CANARY'), false);
});
for (const channel of ['beacons', 'backgroundActivity']) {
  test('Pro aborts ' + channel + ' after navigation during its pending read', async () => {
    const state = setup();
    state.runtime[channel].read = async () => { state.invalidate(); return channel === 'beacons' ? beacon() : background(); };
    await captureAdvancedChannels(state.pro, state.page, request, state.context, new Set());
    assert.equal(state.page[channel], undefined);
  });
  test('Pro removes its owned ' + channel + ' metadata after access loss during persistence', async () => {
    const state = setup(); state.runtime[channel === 'beacons' ? 'backgroundActivity' : 'beacons'] = null;
    state.pro.flush = async () => { state.invalidate(); };
    await captureAdvancedChannels(state.pro, state.page, request, state.context, new Set());
    assert.equal(state.page[channel], undefined); assert.equal(state.sizes.get(channel + ':page'), 0);
  });
}
test('Completed cookie tests reach Pro immediately and stale root results are rejected', () => {
  const state = setup(); retainCookieProbe(state.pro, probe()); assert.equal(state.page.cookieProbes[0].result, 'restored-same');
  delete state.page.cookieProbes; retainCookieProbe(state.pro, probe('42:0:previous')); assert.equal(state.page.cookieProbes, undefined);
  state.runtime.scope.hasDataConsent = false; retainCookieProbe(state.pro, probe()); assert.equal(state.page.cookieProbes, undefined);
});
test('All Pro wire readers contain the shared canonical feature guard', () => {
  for (const file of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    assert.ok(source.includes('!readAdvancedPageFields('), file);
    for (const field of ['beacons', 'backgroundActivity', 'cookieProbes']) assert.ok(source.includes('pageFields.push("' + field + '")'), file + ': ' + field);
  }
});
