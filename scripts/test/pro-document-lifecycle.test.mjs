// ADR-072 / PROD-01: actual delivered managers, native awaits and invalidation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { runtimeSource } from '../production/pro-values-runtime.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows } from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { ProCookieCapture } from '../../apps/production-extension/pro-cookie-capture.js';
import { createVendorRedirectTracker } from '../../apps/production-extension/vendor-redirects.js';
const source=readFileSync(new URL('../../apps/production-extension/background.js',import.meta.url),'utf8');
const contracts=source.slice(0,source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm,'');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(stage){
 const context=vm.createContext({atob,btoa,URL,TextEncoder,structuredClone,setTimeout,clearTimeout,crypto:webcrypto,readCookieSnapshot,normalizeProCookieMetadata,readLoaderRows,readTagManagerDocuments,readSocialRows,readSocialDocuments,mergeLoaderRows,readAdvancedPageFields,ProCookieCapture,createRuntimeVendorRedirects:()=>createVendorRedirectTracker({match:()=>[]}),sanitizeHost:raw=>{try{return new URL(raw).hostname;}catch{return null;}}});
 vm.runInContext(contracts+'\n'+runtimeSource+'\n'+section('// packages/background/src/pro-recording.ts','// packages/background/src/local-probe-window.ts')+'\n'+section('// packages/background/src/api-results.ts','// packages/background/src/response-headers.ts'),context);
 const key='1:0:owned-doc',page={id:'page-1',tabId:1,documentKey:key,apiValues:[],reports:[],resources:[]};
 const binding={documentKey:key,documentId:'owned-doc',tabId:1,frameId:0,accessGranted:true,documentLifecycle:'active'},meta={bound:true,paused:false,revoked:false,accessGranted:true};
 const entered=deferred(),pending=deferred();let authorizations=0,starts=0;
 const row={operation:'Window.innerWidth',techniqueId:'DET-030',phase:'returned-sync',value:{kind:'number',value:12345},parameters:[],count:1};
 const runtime={now:()=>100,scope:{hasDataConsent:true,accessReady:true,accessGeneration:1,isGranted:async()=>{if(++authorizations===stage){entered.resolve();await pending.promise;}return true;}},state:{bindings:new Map([['1:0',binding]]),metas:new Map([[key,meta]])},getProjection:()=>({documentKey:key,coverageState:meta.revoked?'no-access':meta.paused?'paused':'active'}),api:{webNavigation:{getAllFrames:async()=>[{...binding,url:'https://example.com/'}]},tabs:{sendMessage:async(_tab,request)=>{if(request.type==='pro-values-start')++starts;if(stage==='native'&&request.type!=='pro-values-stop'){entered.resolve();await pending.promise;}return{schemaVersion:1,type:'pro-values-cache',sessionId:request.sessionId,available:true,truncated:false,rows:[row]};}}}};
 runtime.apiResults=new context.ApiResultsManager(runtime);
 const manager=new context.ProRecordingManager(runtime);manager.session={id:'owned-session',status:'recording',deadlineAt:1000,pages:[page],limitations:[]};manager.trackedTabs.add(1);manager.currentPages.set(1,page.id);manager.belongsToPage=()=>true;manager.mark=()=>{};
 return{runtime,manager,key,page,binding,meta,entered,pending,get starts(){return starts;},async finish(){clearTimeout(manager.proValueTimer);manager.proValueTimer=null;manager.stopValueCapture();manager.session.status='stopped';}};
}
for(const stage of [1,2,'native'])for(const transition of ['pause','pause-resume','revoke','generation','clear','transport-stop'])test('Pro rejects '+transition+' during '+stage,async()=>{
 const f=fixture(stage);try{
  const work=f.manager.captureValues();await f.entered.promise;
  assert.equal(f.runtime.apiResults.operations.size,1,'Pro operation stays registered across every await');
  if(transition==='pause'||transition==='pause-resume'){f.meta.paused=true;f.runtime.apiResults.afterEvent({type:'ui:pause',documentKey:f.key});if(transition==='pause-resume')f.meta.paused=false;}
  else if(transition==='clear')f.runtime.apiResults.afterEvent({type:'ui:clear',documentKey:f.key});
  else if(transition==='transport-stop')f.runtime.apiResults.afterEvent({type:'transport:stopped',documentKey:f.key});
  else{f.meta.revoked=true;f.meta.accessGranted=false;f.binding.accessGranted=false;f.runtime.apiResults.afterEvent({type:'scope:revoked',documentKeys:[f.key]});if(transition==='generation')f.runtime.scope.accessGeneration++;}
  f.pending.resolve();await work;
  assert.equal(f.starts,stage===1?0:1,'no late START after the first authorization');
  assert.equal(f.page.apiValues.length,0,'no late values after invalidation');
  assert.equal(f.runtime.apiResults.operations.size,0,'invalidation ledger releases settled operations');
 }finally{f.pending.resolve();await f.finish();}
});
test('current native document records and releases its operation',async()=>{const f=fixture(0);try{await f.manager.captureValues();assert.equal(f.starts,1);assert.equal(f.page.apiValues[0].rows.length,1);assert.equal(f.runtime.apiResults.operations.size,0);}finally{await f.finish();}});
test('operation ledger rejects capacity overflow without retaining another token',async()=>{const f=fixture(0);try{for(let i=0;i<8;i++)assert.equal(f.runtime.apiResults.trackOperation({documentKey:f.key,tabId:1,invalid:false}),true);assert.equal(f.runtime.apiResults.trackOperation({documentKey:f.key,tabId:1,invalid:false}),false);assert.equal(f.runtime.apiResults.operations.size,8);}finally{await f.finish();}});
