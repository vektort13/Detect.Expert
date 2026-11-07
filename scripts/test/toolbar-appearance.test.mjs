// ADR-042/045: master status, native action defaults, and stale async update handling.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const badgeSource = section('// packages/background/src/badge.ts', '// packages/background/src/pro-redaction.ts');
function fixture(max=256) {
  const state = { tabs: new Map(), bindings: new Map(), reports: new Map(), metas: new Map() };
  const controls = { observing: true, blocking: false }, calls = [];
  const action = Object.fromEntries(['setIcon', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setTitle', 'setBadgeText'].map(method => [method, async args => calls.push([method, JSON.parse(JSON.stringify(args))])]));
  const api = { action, webNavigation: { getAllFrames: async () => [{frameId:0, documentId:'top', documentLifecycle:'active'}] },
    storage: {local:{get:async()=>({})}, onChanged:{addListener(){},removeListener(){}}}, tabs:{query:async()=>[{id:7}]} };
  const context = vm.createContext({ TECHNIQUE_IDS:['DET-001','DET-002'], MAX_DOCUMENTS_GLOBAL:max, MAX_BINDINGS_PER_TAB:128,
    BADGE_LANGUAGE_KEY:'language', badgeLanguage:()=>null, badgeLabel:()=>null, badgeBrowserLanguage:()=>null, setTimeout:()=>1, clearTimeout(){} });
  vm.runInContext(badgeSource, context);
  const manager = new context.BadgeManager(api, () => state, () => true, () => controls);
  const render = async (id = null) => { manager.mark(id); const item=manager.work.get(id); item.dirty=false; await manager.update(id,item); if(!item.dirty)manager.work.delete(id); };
  const addCount = (tabId=7) => {
    const doc='doc'+tabId;
    state.tabs.set(tabId,{activeTopDocumentKey:doc});
    state.bindings.set('binding'+tabId,{tabId,frameId:0,documentId:'top',documentKey:doc,parentDocumentId:null,documentLifecycle:'active',accessGranted:true});
    state.metas.set(doc,{bound:true,revoked:false,accessGranted:true});
    state.reports.set(doc,{tabId,counters:[{techniqueId:'DET-001',count:3},{techniqueId:'DET-002',count:4}]});
  };
  return {state,controls,calls,api,manager,render,addCount};
}
const written = (f, method, tabId) => f.calls.filter(([name, args]) => name===method && args.tabId===tabId).at(-1)?.[1];
const last = (f, method, tabId) => {
  const value=written(f,method,tabId);
  return tabId!==undefined && (!value || value.text===null) ? written(f,method) : value;
};
const settle = async () => { for(let i=0;i<30;i++)await Promise.resolve(); };

test('blue observation preserves the distinct-technique counter and local original icon', async () => {
  const f=fixture(); f.addCount(); await f.render(); await f.render(7);
  assert.equal(last(f,'setIcon').path[16],'icons/16.png');
  assert.equal(last(f,'setBadgeText',7).text,'2');
  assert.equal(last(f,'setBadgeText').text,'');
  assert.equal(last(f,'setBadgeBackgroundColor',7).color,'#DC2626');
});
test('blocking uses green icon, white ON and green badge globally and for existing tabs', async () => {
  const f=fixture(); f.controls.blocking=true; f.addCount(); await f.render(); await f.render(7);
  assert.equal(last(f,'setIcon').path[32],'icons/green-32.png');
  for(const id of [undefined,7]) {
    assert.equal(last(f,'setBadgeText',id).text,'ON');
    assert.equal(last(f,'setBadgeBackgroundColor',id).color,'#168451');
    assert.equal(last(f,'setBadgeTextColor',id).color,'#FFFFFF');
  }
  assert.ok(f.calls.filter(([method])=>method==='setIcon').every(([,args])=>!Object.hasOwn(args,'tabId')));
});
test('observation OFF wins over blocking and cached nonzero counts', async () => {
  const f=fixture(); f.addCount(); await f.render(); await f.render(7);
  f.controls.blocking=true; await f.render(); await f.render(7);
  f.controls.observing=false; await f.render(); await f.render(7);
  assert.equal(last(f,'setIcon').path[48],'icons/gray-48.png');
  assert.equal(last(f,'setBadgeText',7).text,''); assert.equal(last(f,'setBadgeText').text,'');
  assert.equal(last(f,'setTitle',7).title,'Detect Expert — OFF');
  f.controls.observing=true; await f.render(); await f.render(7);
  assert.equal(last(f,'setBadgeText',7).text,'ON');
  f.controls.blocking=false; await f.render(); await f.render(7);
  assert.equal(last(f,'setBadgeText',7).text,'2');
});
test('status updates do not depend on readable document identity in restricted tabs or Firefox', async () => {
  const f=fixture(); f.addCount(); f.api.webNavigation.getAllFrames=async()=>{throw Error('no-access');};
  f.controls.blocking=true; await f.render(); await f.render(7); assert.equal(last(f,'setBadgeText',7).text,'ON');
  f.controls.observing=false; await f.render(); await f.render(7); assert.equal(last(f,'setBadgeText',7).text,'');
  f.controls.observing=true; await f.render(); await f.render(7); assert.equal(last(f,'setBadgeText',7).text,'ON');
  f.controls.blocking=false; await f.render(); await f.render(7); assert.equal(last(f,'setBadgeText',7).text,'');
  assert.equal(last(f,'setBadgeBackgroundColor',7).color,'#DC2626');
  f.api.webNavigation.getAllFrames=async()=>[{frameId:0}];
  f.controls.blocking=true; await f.render(); await f.render(7);
  f.controls.blocking=false; await f.render(); await f.render(7); assert.equal(last(f,'setBadgeText',7).text,'');
});
test('global defaults cover tabs created before any observation event', async () => {
  const f=fixture(); f.controls.observing=false; f.manager.markAll();
  assert.ok(f.manager.work.has(null)); await f.manager.update(null,f.manager.work.get(null));
  assert.equal(last(f,'setIcon').path[16],'icons/gray-16.png'); assert.equal(last(f,'setBadgeText').text,'');
});
test('a full tab backlog cannot drop the global master update', async () => {
  const f=fixture();
  for(let id=0;id<256;id++) f.manager.mark(id);
  f.controls.observing=false; f.manager.markAll();
  assert.ok(f.manager.work.has(null));
  assert.equal(f.manager.work.size,257);
  f.manager.mark(999); assert.equal(f.manager.work.size,257,'tab work stays bounded');
  f.manager.drain(); await settle();
  assert.equal(last(f,'setIcon').path[16],'icons/gray-16.png');
  assert.equal(last(f,'setBadgeText').text,'');
});
test('markAll invalidates in-flight updates even without captured document or displayed cache', async () => {
  const f=fixture(); let finish;
  f.api.action.setBadgeText=async args=>{await new Promise(done=>{finish=done;});f.calls.push(['setBadgeText',args]);};
  f.controls.blocking=true; const pending=f.render(55);
  await Promise.resolve(); f.controls.observing=false; f.manager.markAll(); finish(); await pending;
  assert.equal(f.manager.displayed.has(55),false,'stale result must not be cached');
  assert.equal(written(f,'setBadgeText',55).text,null,'tab status always inherits master');
  f.api.action.setBadgeText=async args=>f.calls.push(['setBadgeText',args]);
  await f.render(); await f.render(55); assert.equal(last(f,'setBadgeText',55).text,'');
});
test('global delayed icon work cannot complete an obsolete ON badge after OFF', async () => {
  const f=fixture(); let finish;
  f.api.action.setIcon=async args=>{f.calls.push(['setIcon',args]); await new Promise(done=>{finish=done;});};
  f.controls.blocking=true; const pending=f.render(); await Promise.resolve();
  f.controls.observing=false; f.manager.markAll(); finish(); await pending;
  assert.equal(last(f,'setBadgeText'),undefined);
  f.api.action.setIcon=async args=>f.calls.push(['setIcon',args]);
  await f.render(); assert.equal(last(f,'setIcon').path[16],'icons/gray-16.png');
});
test('same state is deduplicated but a status change with the same count is rendered', async () => {
  const f=fixture(); await f.render(); const n=f.calls.length; await f.render(); assert.equal(f.calls.length,n);
  f.controls.observing=false; await f.render(); assert.ok(f.calls.length>n);
});
test('every state asset is a real local PNG of the requested dimensions', () => {
  for(const prefix of ['','green-','gray-']) for(const size of [16,32,48,128]) {
    const png=readFileSync(new URL('../../apps/production-extension/icons/'+prefix+size+'.png',import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG'); assert.equal(png.readUInt32BE(16),size); assert.equal(png.readUInt32BE(20),size);
  }
});
test('master drain has a physical slot while three document reads are stalled', async () => {
  const f=fixture(), release=[];
  f.api.webNavigation.getAllFrames=()=>new Promise(done=>release.push(done));
  for(const id of [1,2,3]) { f.addCount(id); f.manager.mark(id); }
  f.manager.drain(); assert.equal(f.manager.running,3); assert.equal(release.length,3);
  f.controls.observing=false; f.manager.markAll(); f.manager.drain(); await settle();
  assert.equal(last(f,'setIcon').path[16],'icons/gray-16.png');
  assert.equal(last(f,'setBadgeText').text,'');
  assert.equal(f.manager.running,3,'master completed independently of all three reads');
  release.forEach(done=>done([])); await settle(); f.manager.drain(); await settle();
});
test('full counter ownership inherits global on new tabs without forgetting old native counters', async () => {
  const f=fixture(2);
  for(const id of [1,2,3]) { f.addCount(id); await f.render(id); }
  assert.equal(f.manager.displayed.size,2);
  assert.equal(written(f,'setBadgeText',1).text,'2');
  assert.equal(written(f,'setBadgeText',3).text,null);
  f.controls.blocking=true; f.manager.markAll(); f.manager.drain(); await settle();
  assert.equal(last(f,'setBadgeText',1).text,'ON'); assert.equal(last(f,'setBadgeText',2).text,'ON');
  assert.equal(f.manager.displayed.size,1,'only global remains after native resets');
  f.controls.observing=false; f.manager.markAll(); f.manager.drain(); await settle();
  assert.equal(last(f,'setBadgeText',1).text,''); assert.equal(last(f,'setBadgeText',2).text,'');
  assert.ok(f.calls.filter(([method])=>method!=='setBadgeText').every(([,args])=>args.tabId===undefined));
});
test('owner cleanup is admitted and prioritized even with a full unrelated tab queue', async () => {
  const f=fixture(2); f.addCount(1); f.addCount(2); await f.render(1); await f.render(2);
  f.manager.mark(100); f.manager.mark(101);
  f.controls.observing=false; f.manager.markAll();
  assert.equal(f.manager.work.size,5,'two owners + two ordinary tabs + global is bounded');
  f.manager.drain(); await settle();
  assert.equal(written(f,'setBadgeText',1).text,null);
  assert.equal(written(f,'setBadgeText',2).text,null);
  assert.equal(last(f,'setBadgeText',1).text,'');
});
test('pending native writes reserve ownership and cannot overflow or lose a reset', async () => {
  const f=fixture(2), release=[];
  f.api.action.setBadgeText=args=>new Promise(done=>release.push(()=>{f.calls.push(['setBadgeText',args]);done();}));
  f.addCount(1); f.addCount(2); f.addCount(3);
  const a=f.render(1), b=f.render(2); await settle();
  assert.equal(f.manager.displayed.size,2);
  f.manager.mark(3); assert.equal(f.manager.work.has(3),false,'full work queue drops unowned work');
  assert.equal(f.manager.displayed.size,2);
  release.splice(0).forEach(done=>done()); await Promise.all([a,b]);
  f.api.action.setBadgeText=async args=>f.calls.push(['setBadgeText',args]);
  await f.render(3); assert.equal(written(f,'setBadgeText',3).text,null);
  f.controls.observing=false; f.manager.markAll(); f.manager.drain(); await settle();
  assert.equal(last(f,'setBadgeText',1).text,''); assert.equal(last(f,'setBadgeText',2).text,'');
});
test('actual active-tab injectNow refreshes the master only after successful scope change', async () => {
  const method=section('  async injectNow(tabId) {','  changeDataConsent(accepted) {');
  const context=vm.createContext({selectDocumentKey:()=>null,sanitizeHost:()=> 'example.com',uiError:code=>({type:'error',code})});
  const inject=vm.runInContext('({' + method + '}).injectNow',context);
  for(const success of [true,false]) {
    const f=fixture(); f.controls.observing=false; await f.render();
    const order=[]; let releaseHistory;
    const history=new Promise(resolve=>{releaseHistory=resolve;});
    const nativeFrames=f.api.webNavigation.getAllFrames;
    f.api.webNavigation.getAllFrames=async (...args)=>{order.push('native frames');return nativeFrames(...args);};
    const runtime={ready:Promise.resolve(),state:f.state,api:f.api,badge:f.manager,
      async ensureHistory(){order.push('history');await history;order.push('history ready');},
      scope:{injectNow:async()=>{order.push('scope');if(success)f.controls.observing=true;return success;}},
      grantDocumentAccess(){},apply(){},reconcileAccess(){},now:()=>1};
    const pending=inject.call(runtime,7); await settle();
    assert.deepEqual(order,['history'],'unread authority cannot enumerate frames or change scope');
    assert.equal(f.manager.work.has(null),false,'the master is not refreshed while authority is pending');
    releaseHistory(); const result=await pending;
    assert.deepEqual(order,['history','history ready','native frames','scope']);
    assert.equal(result.type,success?'ok':'error');
    assert.equal(f.manager.work.has(null),success);
    f.manager.drain(); await settle();
    assert.equal(last(f,'setIcon').path[16],success?'icons/16.png':'icons/gray-16.png');
    order.length=0;
    runtime.ensureHistory=async()=>{order.push('history');throw Error('authority unavailable');};
    await assert.rejects(inject.call(runtime,7),/authority unavailable/);
    assert.deepEqual(order,['history'],'failed authority never enumerates frames or changes scope');
  }
});
test('protection mutation notifies after commit or failure without changing its result', async () => {
  const start=source.indexOf('var ProtectionController = class'), end=source.indexOf('\n// packages/', start);
  const context=vm.createContext({DEFAULT_PROTECTION_SETTINGS:{enabled:false}}); vm.runInContext(source.slice(start,end),context);
  let notified=0; const controller=new context.ProtectionController({}, {}, ()=>{notified++;});
  assert.equal(await controller.serialize(async()=>42),42); assert.equal(notified,1);
  await assert.rejects(controller.serialize(async()=>{throw Error('original');}),/original/); assert.equal(notified,2);
  controller.onChange=()=>{throw Error('observer');}; assert.equal(await controller.serialize(async()=>17),17);
});
