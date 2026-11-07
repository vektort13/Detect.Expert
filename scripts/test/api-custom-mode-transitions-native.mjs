// ADR-048/049/056: actual mode transitions, with old document handles retained.
// Raw native GPU strings stay in the owned control page; only comparisons leave it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root=resolve(import.meta.dirname,'../..'), argument=process.argv.indexOf('--dist');
const input=argument<0?join(root,'dist/chrome'):resolve(process.argv[argument+1]);
mkdirSync(join(root,'.tmp'),{recursive:true});const run=mkdtempSync(join(root,'.tmp/api-custom-modes-')),extension=join(run,'extension');
cpSync(input,extension,{recursive:true});
const chosen={vendor:'Owned Custom Vendor',renderer:'Owned Custom Renderer',unmaskedVendor:'Owned Custom Unmasked Vendor',unmaskedRenderer:'Owned Custom Unmasked Renderer'};
const estimate={quota:424242,usage:123};
const output=join(root,'test-results/production-1.1.0/api-custom-mode-transitions-native.json');
const evidence={at:new Date().toISOString(),result:'RUNNING',input,run,checks:[],stages:[],limits:[],hashes:Object.fromEntries(
  ['manifest.json','api-configuration-controller.js','api-custom-registration.js','api-custom-runtime.js','api-custom-document-runtime.js','protection-runtime.js']
    .map(name=>[name,createHash('sha256').update(readFileSync(join(extension,name))).digest('hex')]))};
function ownedFixture(chosen,estimate){
  const parameters=[7936,7937,37445,37446],keys=['vendor','renderer','unmaskedVendor','unmaskedRenderer'];
  const kinds=['webgl','webgl2'],contexts=[];
  for(const kind of kinds){const canvas=document.createElement('canvas'),context=canvas.getContext(kind);if(context){context.getExtension('WEBGL_debug_renderer_info');contexts.push({kind,context,saved:context.getParameter,prototype:(kind==='webgl'?WebGLRenderingContext:WebGL2RenderingContext).prototype});}}
  function raw(){return contexts.map(row=>({kind:row.kind,values:['direct','saved','prototype'].map(method=>parameters.map(parameter=>{
    try{return Reflect.apply(method==='saved'?row.saved:method==='prototype'?row.prototype.getParameter:row.context.getParameter,row.context,[parameter]);}catch{return null;}
  }))}));}
  function summary(){return {contexts:raw().map(row=>({kind:row.kind,custom:row.values.map(values=>values.map((value,index)=>value===chosen[keys[index]]))})),
    fresh:kinds.map(kind=>Boolean(document.createElement('canvas').getContext(kind))),twoD:Boolean(document.createElement('canvas').getContext('2d'))};}
  const original=raw(),windows=new Map();
  window.readOwned=summary;window.firstOwned=summary();window.__ownedRaw=raw;
  window.openOwned=(key,url)=>{const child=window.open(url,'_blank');windows.set(key,child);};
  window.compareOwned=key=>{const child=windows.get(key),candidate=child.__ownedRaw();return candidate.map(row=>({kind:row.kind,native:row.values.map(values=>values.map((value,index)=>value===original.find(native=>native.kind===row.kind)?.values[0][index]))}));};
  window.ownedEstimateSettled=false;
  window.ownedEstimate=navigator.storage.estimate();window.ownedEstimate.then(()=>{window.ownedEstimateSettled=true;});
  window.readOwnedEstimate=async()=>{const value=await window.ownedEstimate;return {custom:value.quota===estimate.quota&&value.usage===estimate.usage};};
  window.addOwnedFrame=url=>new Promise(resolve=>{const frame=document.createElement('iframe');frame.onload=()=>resolve(true);frame.src=url;document.body.appendChild(frame);});
}
const server=createServer((request,response)=>{request.resume();response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><title>Owned mode transition</title><script>('+ownedFixture.toString()+')('+JSON.stringify(chosen)+','+JSON.stringify(estimate)+')</script><body>Owned mode transition');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
let context,settings,control,phase='setup';const check=message=>{evidence.checks.push(message);console.log('  ok '+message);};
const send=message=>settings.evaluate(value=>chrome.runtime.sendMessage({schemaVersion:1,...value}),message);
const counts=()=>settings.evaluate(async()=>({user:(await chrome.userScripts.getScripts()).filter(row=>row.id.startsWith('detector-api-custom-profile-v2-')).length,
  opaque:(await chrome.scripting.getRegisteredContentScripts()).filter(row=>row.id.startsWith('detector-api-custom-fallback-v2-')).length}));
async function setMode(mode){const state=await send({type:'ui-api-config-get',tabId:null});const configuration={...state.configuration,enabled:true,antidetectEnabled:true,preset:'custom',sites:[],apis:state.configuration.apis.map(row=>({...row,
  mode:row.id==='webgl'?mode:row.id==='storage-estimate'&&mode==='custom'?'custom':'bypass',
  selected:row.id==='webgl'?{kind:'value',value:chosen}:row.id==='storage-estimate'?{kind:'value',value:estimate}:{kind:'unset'}}))};
  const saved=await send({type:'ui-api-config-set',tabId:null,expectedRevision:state.revision,configuration});assert.equal(saved.type,'api-config-state');assert.notEqual(saved.registration,'error');return saved;}
async function openOwned(key,path){const pending=context.waitForEvent('page');await control.evaluate(({key,url})=>window.openOwned(key,url),{key,url:origin+path});const page=await pending;await page.waitForLoadState('load');return page;}
const allCustom=value=>value.contexts.length===2&&value.contexts.every(row=>row.custom.every(method=>method.every(Boolean)));
const hasCustom=value=>value.contexts.some(row=>row.custom.some(method=>method.some(Boolean)));
const allNative=value=>value.length===2&&value.every(row=>row.native.every(method=>method.every(Boolean)));
try{
  context=await chromium.launchPersistentContext(join(run,'profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--enable-unsafe-swiftshader']});
  evidence.browser=context.browser().version();const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),base=new URL('.',worker.url()).href;
  settings=await context.newPage();await settings.goto(base+'options.html#api');settings=await enableChromeUserScripts(context,settings,new URL(base).host,evidence);
  assert.equal((await send({type:'ui-data-consent-set',version:1,accepted:true})).accepted,true);assert.equal((await send({type:'ui-set-scope',scopeMode:'all-sites'})).type,'scope');
  control=await context.newPage();await control.goto(origin+'/control');const native=await control.evaluate(()=>firstOwned);assert.equal(native.contexts.length,2,'Real WebGL1 and WebGL2 are required, never represented as passed when absent');assert.equal(hasCustom(native),false);
  for(const mode of ['bypass','off','on']){
    phase='custom to '+mode;await setMode('custom');assert.deepEqual(await counts(),{user:1,opaque:1});
    const oldKey='old-'+mode,old=await openOwned(oldKey,'/custom-'+mode);const initial=await old.evaluate(()=>firstOwned);assert.equal(allCustom(initial),true);
    const settledBeforeSave=await old.evaluate(()=>ownedEstimateSettled);const saved=await setMode(mode);const registrations=await counts();assert.deepEqual(registrations,{user:0,opaque:0});
    const retained=await old.evaluate(()=>readOwned()),retainedEstimate=await old.evaluate(()=>readOwnedEstimate());assert.equal(allCustom(retained),true);assert.equal(retainedEstimate.custom,true);
    const freshKey='fresh-'+mode,fresh=await openOwned(freshKey,'/fresh-'+mode);const first=await fresh.evaluate(()=>firstOwned);assert.equal(hasCustom(first),false,'The new independent document must not inherit an old Custom value');
    if(mode==='on')await fresh.waitForFunction(()=>readOwned().fresh.every(available=>!available),{timeout:10000});
    const current=await fresh.evaluate(()=>readOwned()),comparison=await control.evaluate(key=>compareOwned(key),freshKey),freshEstimate=await fresh.evaluate(()=>readOwnedEstimate());
    assert.equal(hasCustom(current),false);assert.equal(freshEstimate.custom,false);assert.equal(current.twoD,true);
    if(mode!=='on'){assert.equal(allNative(comparison),true);assert.deepEqual(current.fresh,[true,true]);}else assert.deepEqual(current.fresh,[false,false]);
    // A new accessible child of an old Custom document remains inside that
    // parent's immutable privacy boundary. Keep this distinct from a fresh tab.
    const childPath='/http-child-'+mode;await old.evaluate(url=>addOwnedFrame(url),origin+childPath);const child=old.frames().find(frame=>frame.url()===origin+childPath);assert.ok(child);
    const childFirst=await child.evaluate(()=>firstOwned),childCurrent=await child.evaluate(()=>readOwned());
    await old.reload();if(mode==='on')await old.waitForFunction(()=>readOwned().fresh.every(available=>!available),{timeout:10000});
    const afterReload=await old.evaluate(()=>readOwned()),reloadComparison=await control.evaluate(key=>compareOwned(key),oldKey);
    assert.equal(hasCustom(afterReload),false);if(mode!=='on')assert.equal(allNative(reloadComparison),true);else assert.deepEqual(afterReload.fresh,[false,false]);
    const stage={mode,revision:saved.revision,reloadRequired:saved.reloadRequired,registrations,oldRetainedCustom:allCustom(retained),oldEstimateRetainedCustom:retainedEstimate.custom,
      oldEstimateSettledBeforeSave:settledBeforeSave,freshFirstHasCustom:hasCustom(first),freshCurrentHasCustom:hasCustom(current),freshCurrentContexts:current.fresh,
      freshMatchesNative:allNative(comparison),freshEstimateCustom:freshEstimate.custom,httpChildFirstHasCustom:hasCustom(childFirst),httpChildCurrentHasCustom:hasCustom(childCurrent),
      httpChildSavedMethodCustom:childCurrent.contexts.map(row=>({kind:row.kind,custom:row.custom[1].every(Boolean)})),
      parentReloadHasCustom:hasCustom(afterReload),parentReloadMatchesNative:allNative(reloadComparison),parentReloadContexts:afterReload.fresh};evidence.stages.push(stage);
    check('Custom → '+mode+': real future registrations removed; independent document has no old Custom; old handles retain their document profile');
    await old.close();await fresh.close();
  }
  await setMode('custom');
  for(const mode of ['bypass','off']){
    phase='site '+mode+' with global Custom';const state=await send({type:'ui-api-config-get',tabId:null}),configuration={...state.configuration,
      sites:[{host:'127.0.0.1',disabled:false,apis:state.configuration.apis.map(({id})=>({id,mode:id==='webgl'?mode:'bypass',selected:{kind:'unset'},settings:{}}))}]};
    const saved=await send({type:'ui-api-config-set',tabId:null,expectedRevision:state.revision,configuration});assert.equal(saved.type,'api-config-state');assert.notEqual(saved.registration,'error');
    const key='site-'+mode,page=await openOwned(key,'/site-'+mode),first=await page.evaluate(()=>firstOwned),comparison=await control.evaluate(key=>compareOwned(key),key);
    assert.equal(allCustom(first),mode==='bypass');assert.equal(allNative(comparison),mode==='off');
    evidence.stages.push({scope:'site',mode,globalMode:'custom',revision:saved.revision,firstHasCustom:hasCustom(first),matchesNative:allNative(comparison)});
    check('Site '+mode+' with global Custom '+(mode==='bypass'?'inherits the selected global WebGL metadata':'explicitly restores native WebGL metadata in the new document'));await page.close();
  }
  phase='trusted Save and reload';await setMode('custom');
  const reloadKey='trusted-ui-reload',reloadPage=await openOwned(reloadKey,'/trusted-ui-reload');assert.equal(allCustom(await reloadPage.evaluate(()=>readOwned())),true);
  await setMode('off');assert.equal(allCustom(await reloadPage.evaluate(()=>readOwned())),true);
  const reloadTabId=await settings.evaluate(url=>chrome.tabs.query({}).then(rows=>rows.find(row=>row.url===url)?.id),reloadPage.url());assert.ok(Number.isInteger(reloadTabId));
  const beforeReload=await send({type:'ui-api-config-get',tabId:reloadTabId});assert.equal(typeof beforeReload.documentId,'string');
  await settings.goto(base+'options.html?tabId='+reloadTabId+'#api');await settings.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor();
  const navigation=reloadPage.waitForNavigation({waitUntil:'load'});await settings.locator('[data-protection-save-reload]').click();await navigation;
  const uiReloadSummary=await reloadPage.evaluate(()=>readOwned()),uiReloadComparison=await control.evaluate(key=>compareOwned(key),reloadKey),afterReload=await send({type:'ui-api-config-get',tabId:reloadTabId});
  assert.equal(hasCustom(uiReloadSummary),false);assert.equal(allNative(uiReloadComparison),true);assert.notEqual(afterReload.documentId,beforeReload.documentId);
  evidence.stages.push({case:'trusted-save-and-reload',targetTabUnchanged:true,documentChanged:true,hasCustom:false,matchesNative:true});
  check('The real trusted Save and reload button reloads the exact target document and removes old Custom WebGL metadata');await reloadPage.close();
  evidence.limits.push('Old document and its accessible descendants retain the old profile until that parent is reloaded; independent future documents use the saved mode.');
  evidence.limits.push('The native estimate Promise may already settle before saving; exact deferred-settlement semantics are covered by runtime unit tests, not claimed by this native timing check.');
  evidence.result='PASS';
}catch(error){evidence.result='FAIL';evidence.failure={phase,name:error.name,message:String(error.message).replace(/https?:\/\/\S+/g,'[URL omitted]').slice(0,350)};process.exitCode=1;console.error(JSON.stringify(evidence.failure));}
finally{await context?.close();await new Promise(done=>server.close(done));mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(evidence.result+': '+output);}
