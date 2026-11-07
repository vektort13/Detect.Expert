import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readCookieRequest, readClearCookiesRequest, readClearCookiesResult, readCookieViewRequest, readCookieView, readCookieValueRequest, readCookieValueResult } from '../../packages/contracts/src/inspection.mjs';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const verifier = source.slice(source.indexOf('function verifyUiSender('), source.indexOf('function redactSenderContext('));
const handler = source.slice(source.indexOf('async function route(runtime, message, sender)'), source.indexOf('function createMessageListener(runtime)'));
assert.ok(verifier.startsWith('function verifyUiSender(') && handler.startsWith('async function route('));

function fixture({ consent = true, result } = {}) {
  const calls = [], origin = 'chrome-extension://fixture';
  const context = vm.createContext({ readCookieRequest, readClearCookiesRequest, readClearCookiesResult, readCookieViewRequest, readCookieView, readCookieValueRequest, readCookieValueResult,
    selfOrigin: () => origin, uiError: code => ({ schemaVersion: 1, type: 'error', code }) });
  vm.runInContext(verifier + '\n' + handler, context);
  const request = { schemaVersion: 1, type: 'ui-clear-site-cookies', tabId: 7, documentKey: '7:0:doc' };
  const runtime = { api: { runtime: { id: 'fixture' } }, whenReady: async () => {}, scope: { hasDataConsent: consent },
    cookies: { async clearSite(request) { calls.push(request); return result ?? { schemaVersion: 1, type: 'cookies-clear-state', documentKey: request.documentKey, removedCount: 3, failedCount: 0, truncated: false }; },
      async read(request) { calls.push(request); return result; }, values: { async reveal(request) { calls.push(request); return result; } } } };
  return { calls, request, sender: { id: 'fixture', origin, url: origin + '/popup.html', tab: { id: 10 } }, send: (message, sender) => context.route(runtime, message, sender) };
}

test('Cookie cleanup route rejects page, foreign-extension and mismatched UI senders before native work', async () => {
  const f = fixture();
  for (const sender of [{ ...f.sender, origin: 'https://example.com', url: 'https://example.com/' }, { ...f.sender, id: 'foreign' }, { ...f.sender, origin: undefined }, { ...f.sender, url: 'https://example.com/' }]) assert.equal((await f.send(f.request, sender)).code, 'unauthorized-sender');
  assert.equal(f.calls.length, 0);
});

test('Cookie value route rejects page senders, revoked consent and caller target overrides',async()=>{
  for(const type of ['ui-get-cookie-view','ui-get-cookie-value']){
    const f=fixture(),request={schemaVersion:1,type,tabId:7,documentKey:'7:0:doc',...(type.endsWith('value')?{handle:'a'.repeat(32)}:{})};
    assert.equal((await f.send(request,{...f.sender,origin:'https://example.com',url:'https://example.com/'})).code,'unauthorized-sender');
    assert.equal((await f.send({...request,domain:'foreign.test'},f.sender)).code,'invalid-request');assert.equal(f.calls.length,0);
    const denied=fixture({consent:false});assert.equal((await denied.send(request,denied.sender)).code,'no-access');assert.equal(denied.calls.length,0);
  }
});
test('Cookie value route projects only the exact clicked handle and selected document',async()=>{
  const handle='a'.repeat(32),request={schemaVersion:1,type:'ui-get-cookie-value',tabId:7,documentKey:'7:0:doc',handle};
  const result={schemaVersion:1,type:'cookie-value-state',documentKey:request.documentKey,handle,value:'LIVE_UI_ONLY_CANARY',truncated:false};
  const f=fixture({result});assert.equal((await f.send(request,f.sender)).value,'LIVE_UI_ONLY_CANARY');assert.equal(f.calls.length,1);
  for(const extra of [{documentKey:'8:0:other'},{handle:'b'.repeat(32)},{path:'/PRIVATE'},{storeId:'foreign'},{value:'x'.repeat(16385)}]){
    const rejected=fixture({result:{...result,...extra}});assert.equal((await rejected.send(request,rejected.sender)).code,'no-access');
  }
});
test('Cookie view route rejects raw value fields and sanitizes internal failures',async()=>{
  const request={schemaVersion:1,type:'ui-get-cookie-view',tabId:7,documentKey:'7:0:doc'};
  for(const result of [{schemaVersion:1,type:'cookies-view-state',snapshot:{value:'SECRET_CANARY'},handles:[]},{schemaVersion:1,type:'error',code:'SECRET_CANARY'}]){
    const f=fixture({result}),response=await f.send(request,f.sender);assert.equal(response.code,'no-access');assert.doesNotMatch(JSON.stringify(response),/CANARY/);
  }
});

test('Cookie cleanup route requires collection consent and disallows caller-selected domain or store', async () => {
  const denied = fixture({ consent: false });
  assert.equal((await denied.send(denied.request, denied.sender)).code, 'no-access'); assert.equal(denied.calls.length, 0);
  const f = fixture();
  for (const extra of [{ domain: 'foreign.test' }, { storeId: 'other-container' }, { url: 'https://foreign.test/' }, { frameId: 1 }]) assert.equal((await f.send({ ...f.request, ...extra }, f.sender)).code, 'invalid-request');
  assert.equal(f.calls.length, 0);
});

test('Cookie cleanup route admits one canonical UI command and projects only bounded completion counts', async () => {
  const f = fixture(); const response = await f.send(f.request, f.sender);
  assert.equal(response.removedCount, 3); assert.equal(response.failedCount, 0);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].frameId, 0);
  assert.deepEqual(Object.keys(response).sort(), ['schemaVersion', 'type', 'documentKey', 'removedCount', 'failedCount', 'truncated'].sort());
});

test('Cookie cleanup route rejects accidental raw identities and sanitizes native failure codes', async () => {
  for (const result of [
    { schemaVersion: 1, type: 'cookies-clear-state', documentKey: '7:0:doc', removedCount: 1, failedCount: 0, truncated: false, names: ['PRIVATE_IDENTITY_CANARY'] },
    { schemaVersion: 1, type: 'cookies-clear-state', documentKey: '7:0:doc', removedCount: 4097, failedCount: 0, truncated: false },
    { schemaVersion: 1, type: 'cookies-clear-state', documentKey: '8:0:other', removedCount: 3, failedCount: 0, truncated: false },
    { schemaVersion: 1, type: 'error', code: 'NATIVE_SECRET_CANARY' }
  ]) {
    const f = fixture({ result }), response = await f.send(f.request, f.sender);
    assert.equal(response.code, 'no-access'); assert.doesNotMatch(JSON.stringify(response), /CANARY/);
  }
});
