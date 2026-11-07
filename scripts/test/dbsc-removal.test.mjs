// REQ-004/010/013/015, ADR-044: removal must preserve old recordings and Cookie data.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as inspection from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { ProCookieCapture } from '../../apps/production-extension/pro-cookie-capture.js';
import { createVendorRedirectTracker } from '../../apps/production-extension/vendor-redirects.js';
const root = new URL('../../', import.meta.url), read = path => readFileSync(new URL(path, root), 'utf8');
const cookie = () => ({ name: '_ga', domain: 'example.test', hostOnly: false, secure: true, httpOnly: false, session: false, sameSite: 'lax', partitioned: false, tracking: true, category: 'analytics', owner: 'Google', purpose: 'Analytics identifier', confidence: 'documented', ruleIds: ['cookie-ga'], sourceUrls: [], boundSessionStatus: 'matched' });
const snapshot = () => ({ schemaVersion: 1, type: 'cookies-state', documentKey: '7:0:doc', coverageState: 'partial', permission: 'granted', trackingCount: 1, entries: [cookie()], truncated: false, observedAt: 1000, sessionBinding: { status: 'registration-observed', headers: ['secure-session-registration'] } });
const session = () => ({ schemaVersion: 1, id: 'recording-1', domain: 'example.test', siteKey: 'example.test', startTabId: 7, status: 'stopped', startedAt: 1000, deadlineAt: 601000, stoppedAt: 2000, stopReason: 'manual', pages: [{ id: 'page-1', tabId: 7, documentKey: '7:0:doc', url: 'https://example.test/', title: '', startedAt: 1000, endedAt: 2000, reports: [], resources: [], cookies: snapshot() }], limitations: [], dropped: { pages: 0, resources: 0, documents: 0, events: 0 } });
const clean = value => JSON.parse(JSON.stringify(value));

test('DBSC controller, public readers and all UI/localized controls are absent', () => {
  assert.equal(existsSync(new URL('apps/production-extension/dbsc-inspector.js', root)), false);
  for (const key of ['DBSC_HEADERS', 'readDBSCRequest', 'readDBSCState']) assert.equal(inspection[key], undefined);
  for (const name of ['background.js', 'bridge.js', 'popup.js', 'sidepanel.js', 'report.js', 'identification-ui.js']) assert.doesNotMatch(read('apps/production-extension/' + name), /DBSCInspector|readDBSC|useDBSC|ui-dbsc-|cookie_dbsc_|cookie_tpm/);
  for (const base of ['_locales', 'ui-locales']) for (const language of readdirSync(new URL('apps/production-extension/' + base + '/', root))) {
    const keys = Object.keys(JSON.parse(read('apps/production-extension/' + base + '/' + language + '/messages.json')));
    assert.equal(keys.some(key => /^(dbsc_|cookie_dbsc_|cookie_tpm|cookie_binding_|cookie_session_binding$)/.test(key)), false, language);
  }
});

test('old and new Cookie snapshots converge without mutating the old input', () => {
  const old = snapshot(), expected = clean(old); delete expected.sessionBinding; delete expected.entries[0].boundSessionStatus;
  assert.deepEqual(inspection.readCookieSnapshot(old), expected);
  assert.deepEqual(inspection.readCookieSnapshot(expected), expected);
  for (const unused of [null, false, 'obsolete', [], { status: 'unrecognized', privateSession: 'LEGACY_CANARY' }]) {
    old.sessionBinding = unused; old.entries[0].boundSessionStatus = unused;
    assert.deepEqual(inspection.readCookieSnapshot(old), expected);
  }
  const recording = session(), result = inspection.normalizeProCookieMetadata(recording);
  assert.deepEqual(result.pages[0].cookies, expected);
  assert.equal(recording.pages[0].cookies.entries[0].boundSessionStatus, 'matched');
});

test('retired metadata cannot invoke accessors, leak fields or erase otherwise valid cookies', () => {
  let reads = 0;
  for (const field of ['sessionBinding', 'boundSessionStatus']) {
    const old = snapshot(), target = field === 'sessionBinding' ? old : old.entries[0];
    Object.defineProperty(target, field, { get() { ++reads; throw Error('unexpected getter'); } });
    assert.equal(inspection.readCookieSnapshot(old), null);
  }
  const old = snapshot(); Object.defineProperty(old.sessionBinding, 'private', { enumerable: true, get() { ++reads; throw Error('legacy getter'); } });
  assert.ok(inspection.readCookieSnapshot(old)); assert.equal(reads, 0);
});

test('background restore preserves the old recording while removing its retired metadata', () => {
  const source = read('apps/production-extension/background.js');
  const contracts = source.slice(0, source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
  const first = source.indexOf('// packages/background/src/pro-recording.ts'), last = source.indexOf('// packages/background/src/local-probe-window.ts', first);
  assert.ok(first > 0 && last > first);
  // Restore validation does not observe resources; retain the real empty tracker dependency.
  const createRuntimeVendorRedirects = () => createVendorRedirectTracker({ match: () => [] });
  const context = vm.createContext({ URL, TextEncoder, atob, btoa, ...inspection, readAdvancedPageFields, ProCookieCapture, createRuntimeVendorRedirects, serialized: JSON.stringify({ version: 1, session: session() }) });
  vm.runInContext(contracts + '\n' + source.slice(first, last), context);
  const result = vm.runInContext('var manager = new ProRecordingManager({}); manager.restore(JSON.parse(serialized)); manager.session;', context);
  const expected = inspection.normalizeProCookieMetadata(session());
  assert.deepEqual(clean(result), expected);
  assert.equal(result.status, 'stopped'); assert.equal(result.pages[0].cookies.trackingCount, 1);
});

for (const file of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) test(file + ': full Pro validators strip legacy fields before state/export', () => {
  const source = read('apps/production-extension/' + file), marker = 'function validateProSession(';
  const positions = [...source.matchAll(/function validateProSession\(/g)].map(match => match.index);
  assert.ok(positions.length);
  for (const position of positions) {
    const start = source.lastIndexOf('// packages/contracts/src/pro-recording.ts', position), end = source.indexOf('\n// ', position);
    assert.ok(start >= 0 && end > position);
    const context = vm.createContext({ URL, TextEncoder, ...inspection, readAdvancedPageFields, serialized: JSON.stringify(session()) });
    vm.runInContext(source.slice(start, end), context);
    const result = vm.runInContext('validateProSession(JSON.parse(serialized))', context);
    assert.equal(result.ok, true, file);
    assert.doesNotMatch(JSON.stringify(result.value), /sessionBinding|boundSessionStatus/);
    assert.equal(result.value.pages[0].cookies.entries[0].name, '_ga');
    if (typeof context.validateProStateResponse === 'function') {
      const state = vm.runInContext('validateProStateResponse({schemaVersion:1,type:"pro-state",session:JSON.parse(serialized),currentDomain:"example.test",canStart:true})', context);
      assert.equal(state.ok, true); assert.doesNotMatch(JSON.stringify(state.value), /sessionBinding|boundSessionStatus/);
    }
    // Malformed obsolete plain values are ignored; unrelated payloads still fail.
    const legacy = session(); legacy.pages[0].cookies.sessionBinding = 'obsolete'; legacy.pages[0].cookies.entries[0].boundSessionStatus = 'obsolete';
    context.serialized = JSON.stringify(legacy); assert.equal(vm.runInContext('validateProSession(JSON.parse(serialized)).ok', context), true);
    legacy.pages[0].cookies.entries[0].sessionId = 'MUST_NOT_ESCAPE'; context.serialized = JSON.stringify(legacy);
    assert.equal(vm.runInContext('validateProSession(JSON.parse(serialized)).ok', context), false);
  }
});
