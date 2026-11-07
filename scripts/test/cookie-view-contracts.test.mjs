import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCookieViewRequest,readCookieView,readCookieValueRequest,readCookieValueResult,readCookieSnapshot} from '../../packages/contracts/src/inspection.mjs';
const handle='a'.repeat(32),documentKey='7:0:doc';
const entry={name:'sessionid',domain:'example.com',hostOnly:true,secure:true,httpOnly:true,session:true,sameSite:'strict',partitioned:false,tracking:false,category:'unknown',owner:'',purpose:'',confidence:'unknown',ruleIds:[],sourceUrls:[]};
const snapshot=()=>({schemaVersion:1,type:'cookies-state',documentKey,coverageState:'partial',permission:'granted',entries:[entry],trackingCount:0,totalCount:1,siteCount:1,truncated:false,observedAt:1,sessionBinding:{status:'not-observed',headers:[]}});
const view=()=>({schemaVersion:1,type:'cookies-view-state',snapshot:snapshot(),handles:[handle]});
const value=()=>({schemaVersion:1,type:'cookie-value-state',documentKey,handle,value:'LOCAL_VALUE_CANARY',truncated:false});

test('cookie metadata rejects malformed DNS labels while preserving normalized hostnames',()=>{
  for(const domain of ['..a','.example.com','example.com.','a..b','-a.example','a-.example','a'.repeat(64)+'.example'])assert.equal(readCookieSnapshot({...snapshot(),entries:[{...entry,domain}]}),null,domain);
  for(const domain of ['a','example.com','a-b.example','xn--e1afmkfd.xn--p1ai','a'.repeat(63)+'.example','127.0.0.1'])assert.ok(readCookieSnapshot({...snapshot(),entries:[{...entry,domain}]}),domain);
});

test('cookie private contracts: exact requests reject arbitrary native targets and invalid identity',()=>{
  for(const type of ['ui-get-cookie-view','ui-get-cookie-value']){
    const request={schemaVersion:1,type,tabId:7,documentKey,...(type.endsWith('value')?{handle}:{})};
    const reader=type.endsWith('value')?readCookieValueRequest:readCookieViewRequest;
    assert.equal(reader(request).frameId,0);
    for(const extra of [{url:'https://foreign.test/'},{domain:'foreign.test'},{storeId:'foreign'},{path:'/private'},{partitionKey:{}},{frameId:1},{tabId:8}])assert.equal(reader({...request,...extra}),null);
  }
  for(const invalid of [undefined,null,'',handle+'a','A'.repeat(32),'g'.repeat(32)])assert.equal(readCookieValueRequest({schemaVersion:1,type:'ui-get-cookie-value',tabId:7,documentKey,handle:invalid}),null);
});
test('cookie private contracts: live handles never enter persisted metadata snapshots',()=>{
  assert.ok(readCookieView(view()));assert.equal(readCookieSnapshot(view()),null);
  assert.equal(readCookieSnapshot({...snapshot(),handles:[handle]}),null);
  assert.equal(readCookieSnapshot({...snapshot(),entries:[{...entry,value:'LOCAL_VALUE_CANARY'}]}),null);
  for(const handles of [[],[handle,handle],['wrong'],[undefined]])assert.equal(readCookieView({...view(),handles}),null);
  assert.deepEqual(readCookieView({...view(),handles:[null]}).handles,[null]);
  assert.equal(readCookieView({...view(),snapshot:{...snapshot(),entries:[entry,entry],totalCount:2,siteCount:2},handles:[handle,handle]}),null);
});
test('cookie private contracts: only bounded live text is admitted, with empty value distinct',()=>{
  assert.equal(readCookieValueResult(value()).value,'LOCAL_VALUE_CANARY');
  for(const text of ['', '<img src=x onerror=alert(1)>','A\u202eB\nC','x'.repeat(16384)])assert.equal(readCookieValueResult({...value(),value:text}).value,text);
  for(const extra of [{value:'x'.repeat(16385)},{value:null},{value:{toString(){throw Error('coercion');}}},{path:'/PRIVATE'},{storeId:'foreign'},{tpmProtected:true},{handle:'invalid'},{truncated:0}])assert.equal(readCookieValueResult({...value(),...extra}),null);
  assert.equal(readCookieSnapshot(value()),null);assert.equal(readCookieView(value()),null);
});
test('cookie private contracts: descriptor getters and sparse handles are never invoked',()=>{
  let getters=0;
  for(const [reader,input,key]of [[readCookieView,view(),'snapshot'],[readCookieValueRequest,{schemaVersion:1,type:'ui-get-cookie-value',tabId:7,documentKey,handle},'handle'],[readCookieValueResult,value(),'value']]){
    Object.defineProperty(input,key,{enumerable:true,get(){++getters;throw Error('getter');}});assert.equal(reader(input),null);
  }
  const handles=[handle];Object.defineProperty(handles,0,{get(){++getters;throw Error('array getter');}});assert.equal(readCookieView({...view(),handles}),null);
  assert.equal(readCookieView({...view(),handles:new Array(1)}),null);assert.equal(getters,0);
});
