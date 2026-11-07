import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readModesCommand,readModesState,readModesReply,readPrecursorZoneRequest,readPrecursorZoneSnapshot} from '../../packages/contracts/src/precursor-modes.mjs';
const zone={id:'a'.repeat(32),name:'example.com'};
const fresh=()=>({status:'ready',zone:{...zone},mode:'monitor',checkedAt:100,lastKnownMode:'monitor',lastKnownAt:100,errorCode:null,history:[],notifications:false,connected:true});
test('strict mode command rejects extra URLs, methods, page identities, tokens on reads and accessors',()=>{
  assert.equal(readModesCommand({schemaVersion:1,id:1,action:'connect',zoneId:'A'.repeat(32),token:'test-token'}).zoneId,zone.id);
  for(const action of ['read','disconnect','refresh'])assert.deepEqual(readModesCommand({schemaVersion:1,id:1,action}),{schemaVersion:1,id:1,action});
  for(const patch of [{url:'https://evil.test'},{method:'POST'},{token:'secret'},{id:-1},{action:'fetch'}])assert.equal(readModesCommand({schemaVersion:1,id:1,action:'read',...patch}),null);
  for(const token of ['','a\nb','x'.repeat(2049),'a b'])assert.equal(readModesCommand({schemaVersion:1,id:1,action:'connect',zoneId:zone.id,token}),null);
  let reads=0;const value={schemaVersion:1,id:1,action:'connect',zoneId:zone.id};Object.defineProperty(value,'token',{enumerable:true,get(){reads++;return 'secret';}});assert.equal(readModesCommand(value),null);assert.equal(reads,0);
});
test('only validated zone config may carry a current mode; unknown/error cannot claim Off',()=>{
  for(const mode of ['off','monitor','arm'])assert.equal(readModesState({...fresh(),mode}).mode,mode);
  for(const patch of [{status:'stale'},{zone:null},{connected:false},{checkedAt:null},{mode:'armed'},{mode:'max-security'},{token:'secret'},{zone:{...zone,name:'example.com.evil/'}}])assert.equal(readModesState({...fresh(),...patch}),null);
  assert.ok(readModesState({...fresh(),status:'stale',mode:'unknown',connected:false}));
  assert.equal(readModesState({...fresh(),lastKnownMode:'unknown',lastKnownAt:100}),null);
});
test('bounded history copies records and rejects duplicate IDs, unchanged modes, sparse arrays and getters',()=>{
  const original={...fresh(),history:[{id:1,from:'off',to:'monitor',at:100}]},copy=readModesState(original);original.history[0].to='arm';assert.equal(copy.history[0].to,'monitor');
  for(const history of [[{id:1,from:'off',to:'off',at:100}],Array(1),Array.from({length:129},(_,i)=>({id:i+1,from:'off',to:'monitor',at:100}))])assert.equal(readModesState({...fresh(),history}),null);
  let reads=0;const history=[];Object.defineProperty(history,'0',{enumerable:true,get(){reads++;return {};}});assert.equal(readModesState({...fresh(),history}),null);assert.equal(reads,0);
});
test('zone read binds tab/frame/document and exact replies exclude secrets',()=>{
  const request={schemaVersion:1,type:'ui-get-precursor-zone',tabId:3,frameId:0,documentKey:'3:0:doc'};
  assert.ok(readPrecursorZoneRequest(request));assert.equal(readPrecursorZoneRequest({...request,documentKey:'3:1:doc'}),null);
  const reply={schemaVersion:1,type:'precursor-zone-state',documentKey:request.documentKey,state:{status:'ready',zoneName:'example.com',mode:'arm',checkedAt:100,lastChange:null}};assert.ok(readPrecursorZoneSnapshot(reply));assert.equal(readPrecursorZoneSnapshot({...reply,state:{...reply.state,token:'secret'}}),null);
  assert.equal(readPrecursorZoneSnapshot({...reply,state:fresh()}),null,'full account ID/history never enters the document projection');
  assert.ok(readModesReply({schemaVersion:1,id:1,ok:true,state:fresh(),errorCode:null}));assert.equal(readModesReply({schemaVersion:1,id:1,ok:true,state:fresh(),errorCode:'raw vendor secret'}),null);
  assert.equal(readFileSync(new URL('../../packages/contracts/src/precursor-modes.mjs',import.meta.url),'utf8'),readFileSync(new URL('../../apps/production-extension/precursor-modes-contracts.js',import.meta.url),'utf8'));
});
