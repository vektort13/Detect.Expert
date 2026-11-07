import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPrecursorZone} from '../../apps/production-extension/precursor-zone-route.js';
const request={schemaVersion:1,type:'ui-get-precursor-zone',tabId:7,frameId:0,documentKey:'7:0:doc'};
function fixture(){
  const state={status:'ready',zone:{id:'a'.repeat(32),name:'example.com'},mode:'arm',checkedAt:10,lastKnownMode:'arm',lastKnownAt:10,errorCode:null,history:[],notifications:false,connected:true};
  let calls=0;const runtime={state:{bindings:new Map([['7:0',{documentKey:request.documentKey,boundAt:10}]])},scope:{hasDataConsent:true,accessReady:true,accessGeneration:1,isHostGrantedSync:()=>true},
    getProjection:()=>({documentKey:request.documentKey,coverageState:'active',host:{kind:'registrable',value:'example.com'}}),api:{webNavigation:{getFrame:async()=>{calls++;return {documentId:'doc',documentLifecycle:'active',url:'https://example.com/'};}}},
    precursorModes:{getState:()=>state,snapshotForHost:host=>host==='example.com'?state:null}};
  return {runtime,state,get calls(){return calls;}};
}
test('zone route uses actual native host, never redacted registrable-domain match',async()=>{
  const f=fixture();const result=await readPrecursorZone(f.runtime,request);assert.equal(result.state.mode,'arm');
  assert.deepEqual(Object.keys(result.state),['status','zoneName','mode','checkedAt','lastChange']);assert.equal(JSON.stringify(result).includes(f.state.zone.id),false);
  f.runtime.api.webNavigation.getFrame=async()=>({documentId:'doc',documentLifecycle:'active',url:'https://delegated.example.com/'});
  assert.equal((await readPrecursorZone(f.runtime,request)).state,null);
});
test('zone route no consent/no config/wrong document never performs network-identity lookup',async()=>{
  const f=fixture();f.state.zone=null;assert.equal((await readPrecursorZone(f.runtime,request)).state,null);assert.equal(f.calls,0);
  f.runtime.scope.hasDataConsent=false;await readPrecursorZone(f.runtime,request);assert.equal(f.calls,0);
  assert.equal(await readPrecursorZone(f.runtime,{...request,token:'secret'}),null);
});
test('late native replies after revoke or same-key navigation cannot attach zone config',async()=>{
  for(const mutate of [f=>{f.runtime.scope.accessGeneration++;},f=>{f.runtime.state.bindings.set('7:0',{documentKey:request.documentKey,boundAt:11});}]){
    const f=fixture();let done;f.runtime.api.webNavigation.getFrame=()=>new Promise(resolve=>{done=resolve;});const pending=readPrecursorZone(f.runtime,request);await Promise.resolve();mutate(f);done({documentId:'doc',documentLifecycle:'active',url:'https://example.com/'});assert.equal((await pending).state,null);
  }
});
test('Firefox private document resolver is required and exact token mismatches reject',async()=>{
  const f=fixture();f.runtime.api.__detectExpertResolveDocument=async value=>{assert.equal(value.documentId,'doc');return {documentId:'doc',documentLifecycle:'active',url:'https://example.com/'};};
  assert.equal((await readPrecursorZone(f.runtime,request)).state.mode,'arm');assert.equal(f.calls,0);
  f.runtime.api.__detectExpertResolveDocument=async()=>({documentId:'replacement',documentLifecycle:'active',url:'https://example.com/'});assert.equal((await readPrecursorZone(f.runtime,request)).state,null);
});
