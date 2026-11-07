import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readBeaconRequest } from '../../packages/contracts/src/beacons.mjs';
import { readBackgroundRequest } from '../../packages/contracts/src/background-activity.mjs';
import { readCookieProbeRequest } from '../../packages/contracts/src/cookie-probe.mjs';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const verifier = source.slice(source.indexOf('function verifyUiSender('), source.indexOf('function redactSenderContext('));
const handler = source.slice(source.indexOf('async function route(runtime, message, sender)'), source.indexOf('function createMessageListener(runtime)'));
assert.ok(verifier.startsWith('function verifyUiSender(') && handler.startsWith('async function route('));
const origin = 'chrome-extension://fixture';
const types = ['ui-get-beacons', 'ui-get-background-activity', 'ui-refresh-background-activity', 'ui-start-cookie-probe', 'ui-get-cookie-probe', 'ui-cancel-cookie-probe'];
const request = type => ({ schemaVersion: 1, type, tabId: 7, frameId: 0, documentKey: '7:0:doc', ...(type === 'ui-start-cookie-probe' ? { handle: 'a'.repeat(32) } : {}) });
function fixture(consent = true) {
  const calls = [];
  const context = vm.createContext({ readBeaconRequest, readBackgroundRequest, readCookieProbeRequest, selfOrigin: () => origin, uiError: code => ({ schemaVersion: 1, type: 'error', code }) });
  vm.runInContext(verifier + '\n' + handler, context);
  const call = name => async request => { calls.push({ name, request }); return { schemaVersion: 1, type: 'test-completion' }; };
  const runtime = { api: { runtime: { id: 'fixture' } }, whenReady: async () => {}, scope: { hasDataConsent: consent }, beacons: { read: call('beacons') }, backgroundActivity: { read: call('background') }, cookieProbe: { start: call('probe-start'), read: call('probe-read'), cancel: call('probe-cancel') } };
  return { calls, sender: { id: 'fixture', origin, url: origin + '/popup.html' }, send: (message, sender) => context.route(runtime, message, sender) };
}
test('all advanced routes reject MAIN/content-script senders before reading requests or running native work', async () => {
  const f = fixture();
  for (const type of types) {
    const response = await f.send(request(type), { id: 'fixture', origin: 'https://example.com', url: 'https://example.com/main.js', tab: { id: 7 }, frameId: 0, documentId: 'doc' });
    assert.equal(response.code, 'unauthorized-sender', type);
  }
  assert.equal(f.calls.length, 0);
});
test('advanced routes reject foreign or contradictory extension-document identities', async () => {
  const f = fixture();
  for (const type of types) for (const sender of [
    { ...f.sender, id: 'foreign' },
    { ...f.sender, origin: 'chrome-extension://foreign', url: 'chrome-extension://foreign/report.html' },
    { ...f.sender, origin: undefined },
    { ...f.sender, tab: { id: 7 }, url: 'https://example.com/extension-lookalike.html' },
    { ...f.sender, tab: { id: 7 }, url: origin + '.foreign/popup.html' },
  ]) assert.equal((await f.send(request(type), sender)).code, 'unauthorized-sender', type);
  assert.equal(f.calls.length, 0);
});
test('advanced routes require collection consent for real own extension pages', async () => {
  const f = fixture(false);
  for (const type of types) assert.equal((await f.send(request(type), f.sender)).code, 'no-access', type);
  assert.equal(f.calls.length, 0);
});
test('even privileged extension-document callers cannot choose cookie path/domain/store/value or body', async () => {
  const f = fixture(), sender = { ...f.sender, tab: { id: 17 }, frameId: 0, url: origin + '/report.html' };
  for (const type of ['ui-start-cookie-probe', 'ui-get-cookie-probe', 'ui-cancel-cookie-probe']) for (const extra of [
    { domain: 'foreign.test' }, { path: '/private' }, { storeId: 'foreign-container' }, { value: 'PRIVATE_VALUE_CANARY' }, { source: 'indexedDB' }, { partitionKey: { topLevelSite: 'https://foreign.test' } }, { url: 'https://foreign.test/' }, { requestBody: { token: 'PRIVATE_BODY_CANARY' } }, { frameId: 1 }, { documentKey: '8:0:foreign' }, { handle: 'not-an-owned-handle' },
  ]) assert.equal((await f.send({ ...request(type), ...extra }, sender)).code, 'invalid-request', type);
  assert.equal(f.calls.length, 0);
});
test('beacon/background privileged callers cannot select raw metadata or inconsistent frame identities', async () => {
  const f = fixture();
  for (const type of ['ui-get-beacons', 'ui-get-background-activity', 'ui-refresh-background-activity']) for (const extra of [
    { url: 'https://foreign.test/?token=PRIVATE_BODY_CANARY' }, { requestBody: {} }, { includeValues: true }, { documentId: 'foreign' }, { frameId: 1 }, { tabId: 8 }, { schemaVersion: 2 },
  ]) assert.equal((await f.send({ ...request(type), ...extra }, f.sender)).code, 'invalid-request', type);
  assert.equal(f.calls.length, 0);
});
test('canonical advanced routes dispatch one owned operation without caller extras', async () => {
  const f = fixture();
  for (const type of types) assert.equal((await f.send(request(type), f.sender)).type, 'test-completion', type);
  assert.deepEqual(f.calls.map(call => call.name), ['beacons', 'background', 'background', 'probe-start', 'probe-read', 'probe-cancel']);
  for (let index = 0; index < types.length; ++index) assert.deepEqual(f.calls[index].request, request(types[index]));
});
