import test from 'node:test';
import assert from 'node:assert/strict';
import {reloadDetectorSource,readDetectorMovementAuthorization} from '../../apps/production-extension/detector-source-controller.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(mode='all-sites'){
 const updates=new Set(),removals=new Set(),calls=[];let reads=0;
 const f={url:'https://owned.example/path',mode,accepted:true,complete:true,current:true};
 const api={tabs:{async get(id){calls.push(['get',id]);reads++;return{id,url:f.url};},async reload(id){calls.push(['reload',id]);if(f.complete)for(const fn of updates)fn(id,{status:'complete'});},onUpdated:{addListener:fn=>updates.add(fn),removeListener:fn=>updates.delete(fn)},onRemoved:{addListener:fn=>removals.add(fn),removeListener:fn=>removals.delete(fn)}},runtime:{async sendMessage(m){calls.push(['message',m.type]);if(m.type==='ui-data-consent-get')return{schemaVersion:1,type:'data-consent-state',version:1,accepted:f.accepted};if(m.type==='ui-get-scope')return{schemaVersion:1,type:'scope',scope:{scopeMode:f.mode}};if(m.type==='ui-inject-now')return f.injectReply??{schemaVersion:1,type:'ok',reportRevision:null};throw Error('Unexpected mutation');}}};
 return Object.assign(f,{api,calls,updates,removals,get reads(){return reads;},run:options=>reloadDetectorSource(api,7,{isCurrent:()=>f.current,...options})});
}
test('source reload calls native reload once and never enables consent or changes persistent scope',async()=>{
 for(const mode of['all-sites','site','off']){const f=fixture(mode);const result=await f.run();assert.equal(result.reloaded,true);assert.equal(result.lateAttached,false);assert.equal(f.calls.filter(x=>x[0]==='reload').length,1);assert.deepEqual(f.calls.filter(x=>x[0]==='message').map(x=>x[1]),['ui-data-consent-get','ui-get-scope']);}
});
test('active-tab reload registers completion first and reconnects only through the existing guarded route',async()=>{
 const f=fixture('active-tab');const result=await f.run();assert.equal(result.lateAttached,true);assert.equal(result.accessFailed,false);assert.equal(f.calls.filter(x=>x[0]==='reload').length,1);assert.equal(f.calls.filter(x=>x[1]==='ui-inject-now').length,1);assert.equal(f.updates.size,0);assert.equal(f.removals.size,0);
});
test('active-tab permission refusal stays a completed reload with an explicit access failure',async()=>{
 const f=fixture('active-tab');f.injectReply={schemaVersion:1,type:'error',code:'no-access'};assert.deepEqual(await f.run(),{reloaded:true,lateAttached:false,accessFailed:true});
});
test('unavailable, restricted, mismatched and changed native source identities cannot trigger a reload',async()=>{
 for(const change of[f=>{f.url='chrome://settings/';},f=>{f.api.tabs.get=async()=>({id:8,url:f.url});},f=>{f.api.tabs.get=async()=>{throw Error('closed');};},f=>{let n=0;f.api.tabs.get=async id=>({id,url:++n===1?f.url:'https://changed.example/'});}]){const f=fixture();change(f);await assert.rejects(f.run());assert.equal(f.calls.some(x=>x[0]==='reload'),false);}
});
test('a hidden or changed source after initial reads prevents the native mutation',async()=>{
 const f=fixture();const original=f.api.tabs.get;let n=0;f.api.tabs.get=async id=>{const tab=await original(id);if(++n===2)f.current=false;return tab;};await assert.rejects(f.run());assert.equal(f.calls.some(x=>x[0]==='reload'),false);
});
test('abort and tab removal close listeners and forbid a delayed active-tab reinjection',async()=>{
 for(const event of['abort','remove']){const f=fixture('active-tab');f.complete=false;const a=new AbortController(),pending=f.run({signal:a.signal});await turn();if(event==='abort')a.abort();else for(const fn of f.removals)fn(7);await assert.rejects(pending);for(const fn of f.updates)fn(7,{status:'complete'});assert.equal(f.calls.some(x=>x[1]==='ui-inject-now'),false);assert.equal(f.updates.size,0);assert.equal(f.removals.size,0);}
});
test('completion timeout ends only the owned wait and never fabricates access',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture('active-tab');f.complete=false;const pending=f.run();await turn();t.mock.timers.tick(15001);await assert.rejects(pending);assert.equal(f.calls.some(x=>x[1]==='ui-inject-now'),false);assert.equal(f.updates.size,0);assert.equal(f.removals.size,0);
});
test('scope loss while reload is in flight prevents reconnect, and unrelated events do not settle the wait',async()=>{
 const f=fixture('active-tab');f.complete=false;const pending=f.run();await turn();for(const fn of f.updates)fn(8,{status:'complete'});assert.equal(f.calls.some(x=>x[1]==='ui-inject-now'),false);f.mode='off';for(const fn of f.updates)fn(7,{status:'complete'});await assert.rejects(pending);assert.equal(f.calls.some(x=>x[1]==='ui-inject-now'),false);
});

function movementAuthority(mode='all-sites'){
 const f={mode,accepted:true,current:true,documentKey:'main-key',coverage:'active',grants:[{tabId:7,documentId:'native-main'}],calls:[]};
 f.api={runtime:{async sendMessage(m){f.calls.push(m.type);if(m.type==='ui-data-consent-get')return{schemaVersion:1,type:'data-consent-state',version:1,accepted:f.accepted};if(m.type==='ui-get-scope')return{schemaVersion:1,type:'scope',scope:{scopeMode:f.mode,hosts:['owned.example'],grantedAllSites:true}};if(m.type==='ui-get-report')return{schemaVersion:1,type:'report',report:{documentKey:f.documentKey,coverageState:f.coverage}};throw Error('No mutation allowed');}},storage:{session:{async get(key){assert.equal(key,'active-tabs');f.calls.push('read-active-tabs');return{'active-tabs':f.grants};}}}};
 f.run=()=>readDetectorMovementAuthorization(f.api,7,{isCurrent:()=>f.current,expectedDocumentKey:'main-key'});return f;
}
test('movement authorization passes the freshly authorized scope and reads exact existing active-document grant only for active-tab',async()=>{
 for(const mode of['all-sites','site','active-tab']){const f=movementAuthority(mode),result=await f.run();assert.equal(result.scopeMode,mode);assert.deepEqual(result.hosts,['owned.example']);assert.equal(result.grantedAllSites,true);assert.equal(result.activeDocumentId,mode==='active-tab'?'native-main':undefined);assert.equal(f.calls.includes('read-active-tabs'),mode==='active-tab');assert.equal(f.calls.some(x=>/set|inject|start/u.test(x)),false);}
});
test('movement authorization refuses off, revoked, no-access and mismatched document snapshots',async()=>{
 for(const change of[f=>{f.mode='off';},f=>{f.accepted=false;},f=>{f.coverage='no-access';},f=>{f.documentKey='other-key';},f=>{f.current=false;}]){const f=movementAuthority();change(f);assert.equal(await f.run(),false);assert.equal(f.calls.includes('read-active-tabs'),false);}
});
test('active-document authority rejects absent, duplicate, malformed or unbounded stored grant rows',async()=>{
 for(const rows of[undefined,[],[{tabId:8,documentId:'other'}],[{tabId:7,documentId:'native-main'},{tabId:7,documentId:'duplicate'}],[{tabId:7,documentId:'bad document'}],Array.from({length:513},()=>({tabId:8,documentId:'other'}))]){const f=movementAuthority('active-tab');f.grants=rows;assert.equal(await f.run(),false);}
});
test('a delayed existing active-grant read cannot authorize a changed source',async()=>{
 const f=movementAuthority('active-tab');let release;f.api.storage.session.get=()=>new Promise(done=>{release=done;});const pending=f.run();await turn();f.current=false;release({'active-tabs':f.grants});assert.equal(await pending,false);
});
