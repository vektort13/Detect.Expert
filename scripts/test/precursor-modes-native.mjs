// ADR-076: unchanged extension in owned Chrome; intercepted fixed API is a fixture, not a live zone.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {launchOwnedManagement,until,pause} from './management-browser-fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'test-results/precursor-modes-2026-10-30');
mkdirSync(join(root,'.tmp'),{recursive:true});
const run=mkdtempSync(join(root,'.tmp/precursor-modes-native-')),extension=join(run,'extension');cpSync(join(root,'dist/chrome'),extension,{recursive:true});
const files=['manifest.json','background.js','precursor-modes-service.js','precursor-modes-contracts.js','precursor-settings.html','precursor-settings.js','precursor-settings-locales.js','precursor-zone-route.js','precursor-zone-ui.js'];
const evidence={at:new Date().toISOString(),result:'RUNNING',run,scope:'native Chrome UI/service with intercepted Cloudflare API fixtures, no live credentials or zone',checks:[],requests:[],errors:[],hashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(extension,file))).digest('hex')]))};
const zone='a'.repeat(32),token='NATIVE_FIXTURE_TOKEN_NOT_A_CREDENTIAL';let opened,phase='launch',mode='off',httpStatus=200,privacyTabId=null;
const fixture=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end('<!doctype html><title>Owned zone fixture</title><script>setTimeout(()=>document.createElement("canvas").getContext("2d").measureText("fixture"),1000)</script>');});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const fixturePort=fixture.address().port;
const check=label=>{evidence.checks.push(label);console.log('ok '+label);};
const getState=()=>opened.evaluate(()=>new Promise((resolve,reject)=>{
  const port=chrome.runtime.connect({name:'detect-expert-precursor-modes-v1'}),id=1,timer=setTimeout(()=>{port.disconnect();reject(Error('state-timeout'));},5000);
  port.onMessage.addListener(value=>{if(value.id===id){clearTimeout(timer);port.disconnect();resolve(value.state);}});port.postMessage({schemaVersion:1,id,action:'read'});
}));
try {
  opened=await launchOwnedManagement({root,run,extension,browser:'chrome',evidence,loopbackHosts:['precursor.example.com','delegated.precursor.example.com','privacy.example.com']});evidence.browserVersion=opened.version;
  opened.context.on('page',page=>page.on('pageerror',error=>evidence.errors.push(error.message)));
  await opened.goto(opened.base+'options.html#settings');
  await until(()=>opened.evaluate(()=>Boolean(document.querySelector('#options-scope-all-sites'))),'scope control');
  await opened.click('#options-scope-all-sites');await opened.click('form.scope:has(#options-scope-all-sites) button[type="submit"]');
  await until(async()=>opened.evaluate(async()=>(await chrome.runtime.sendMessage({schemaVersion:1,type:'ui-get-scope'})).scope?.scopeMode==='all-sites'),'scope all sites');
  await opened.context.route('https://api.cloudflare.com/**',async route=>{
    const request=route.request(),url=new URL(request.url()),headers=await request.allHeaders();
    assert.equal(request.method(),'GET');assert.equal(headers['cloudflare-version'],'1.0');assert.equal(headers.authorization,'Bearer '+token);
    assert.ok(['/client/v4/zones/'+zone,'/client/v4/zones/'+zone+'/precursor'].includes(url.pathname));assert.equal(url.search,'');
    evidence.requests.push({endpoint:url.pathname.endsWith('/precursor')?'precursor':'zone',method:request.method(),status:httpStatus});
    const body=JSON.stringify({success:httpStatus===200,result:url.pathname.endsWith('/precursor')?{mode}:{id:zone,name:'precursor.example.com'}});
    await route.fulfill({status:httpStatus,contentType:'application/json',body});
  });
  privacyTabId=await opened.evaluate(async port=>(await chrome.tabs.create({url:'http://privacy.example.com:'+port+'/',active:false})).id,fixturePort);
  await until(()=>opened.evaluate(async tabId=>(await chrome.tabs.get(tabId)).status==='complete',privacyTabId),'privacy fixture');
  await opened.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{globalThis.__precursorVaultEvent=false;chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&Object.hasOwn(changes,'precursor-credential:v1'))globalThis.__precursorVaultEvent=true;});}}),privacyTabId);
  await opened.goto(opened.base+'precursor-settings.html');await until(()=>opened.evaluate(()=>document.querySelector('#pm-connect')?.disabled===false),'settings ready');
  assert.equal((await getState()).mode,'unknown');assert.equal(evidence.requests.length,0);check('no API traffic before explicit connection; exact own settings port works');
  phase='connect';await opened.fill('#pm-zone-id',zone);await opened.fill('#pm-token',token);await opened.click('#pm-connect');
  await until(async()=>(await getState()).mode==='off','fixture Off',25000);
  assert.equal(await opened.evaluate(()=>document.querySelector('#pm-token').value),'');assert.equal((await getState()).history.length,0);assert.equal(evidence.requests.length,2);
  check('real form verifies zone then reads versioned Off; token field clears; first baseline creates no transition');
  phase='notifications';
  const prompt=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,'scripts/test/owned-permission-prompt.ps1'),'-OwnedProfileRoot',run],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let promptOutput='';prompt.stdout.on('data',bytes=>{promptOutput+=bytes;});prompt.stderr.on('data',()=>{});
  const promptDone=new Promise(resolve=>prompt.on('close',code=>resolve(code)));
  await opened.click('#pm-notifications');await until(async()=>(await getState()).notifications===true,'optional notifications native grant',30000);
  assert.equal(await promptDone,0);evidence.nativePrompt=JSON.parse(promptOutput);
  assert.equal(await opened.evaluate(()=>chrome.permissions.contains({permissions:['notifications']})),true);check('user gesture obtains optional browser notification permission');
  const deliveredNotificationIds=new Set();
  for(const next of ['monitor','arm']){
    phase='transition '+next;mode=next;await pause(11000);await opened.click('#pm-refresh');await until(async()=>(await getState()).mode===next,'fixture '+next);
    const state=await getState();assert.equal(state.history.at(-1).to,next);
    let newNotificationId;
    await until(async()=>{newNotificationId=Object.keys(await opened.evaluate(()=>chrome.notifications.getAll())).find(id=>id.startsWith('precursor-mode-')&&!deliveredNotificationIds.has(id));return Boolean(newNotificationId);},'new unique native transition notification',10000);
    deliveredNotificationIds.add(newNotificationId);
    check('confirmed '+next+' transition recorded and native notification created');
  }
  phase='document zone attribution';
  for(const hostname of ['precursor.example.com','delegated.precursor.example.com']) {
    const tab=await opened.evaluate(({hostname,port})=>chrome.tabs.create({url:'http://'+hostname+':'+port+'/',active:false}),{hostname,port:fixturePort});
    let report;await until(async()=>{report=(await opened.evaluate(tabId=>chrome.runtime.sendMessage({schemaVersion:1,type:'ui-get-report',tabId,frameId:0}),tab.id))?.report;return Boolean(report?.documentKey);},'native document report');
    const reply=await opened.evaluate(value=>chrome.runtime.sendMessage(value),{schemaVersion:1,type:'ui-get-precursor-zone',tabId:tab.id,frameId:0,documentKey:report.documentKey});
    assert.equal(reply.type,'precursor-zone-state');assert.equal(reply.state?.mode??null,hostname==='precursor.example.com'?'arm':null);
    const rejected=await opened.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>new Promise(resolve=>{const port=chrome.runtime.connect({name:'detect-expert-precursor-modes-v1'});port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;resolve(true);});setTimeout(()=>resolve(false),1500);})}))[0].result,tab.id);
    assert.equal(rejected,true);await opened.evaluate(tabId=>chrome.tabs.remove(tabId),tab.id);
  }
  check('native document route exposes Armed only for exact verified apex; subdomains and content-script control ports are rejected');
  phase='same mode';await pause(11000);await opened.click('#pm-refresh');await until(()=>opened.evaluate(()=>document.querySelector('#pm-refresh').disabled===false),'refresh settled');assert.equal((await getState()).history.length,2);check('unchanged mode does not duplicate transitions');
  phase='error';httpStatus=503;await pause(11000);await opened.click('#pm-refresh');await until(async()=>(await getState()).status==='stale','HTTP error stale');assert.equal((await getState()).mode,'unknown');assert.equal((await getState()).lastKnownMode,'arm');assert.equal((await getState()).history.length,2);check('503 becomes stale/unknown while retaining last confirmed Armed and history');
  phase='storage';const stored=await opened.evaluate(()=>Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)]));assert.equal(JSON.stringify(stored[0]).includes(token),false);
  const vaultKeys=Object.keys(stored[1]).filter(key=>JSON.stringify(stored[1][key]).includes(token));assert.deepEqual(vaultKeys,['precursor-credential:v1']);
  const isolation=await opened.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:async()=>{let read=false;try{await chrome.storage.session.get('precursor-credential:v1');read=true;}catch{}return {read,event:globalThis.__precursorVaultEvent};}}))[0].result,privacyTabId);
  assert.deepEqual(isolation,{read:false,event:false});await opened.evaluate(tabId=>chrome.tabs.remove(tabId),privacyTabId);privacyTabId=null;
  check('token exists only in the trusted browser-session memory vault; local and report records contain no token');
  check('native ISOLATED content script cannot read the credential or receive its storage change event');
  phase='revoke';await opened.evaluate(()=>chrome.permissions.remove({permissions:['notifications']}));await until(async()=>(await getState()).notifications===false,'notifications revoke');
  assert.equal((await getState()).connected,true);check('notification revoke preserves the API connection');
  httpStatus=200;
  phase='restart';const ui=opened.context.pages().find(page=>page.url()===opened.base+'precursor-settings.html'),cdp=await opened.context.newCDPSession(ui);let versions=[];
  cdp.on('ServiceWorker.workerVersionUpdated',event=>{versions=event.versions;});await cdp.send('ServiceWorker.enable');await until(()=>versions.some(item=>item.scriptURL===opened.base+'background.js'),'worker version');
  const version=versions.find(item=>item.scriptURL===opened.base+'background.js');await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});await cdp.detach();await opened.goto(opened.base+'precursor-settings.html');
  await until(async()=>(await getState()).mode==='arm','worker reconnect after persisted backoff',85000);const restored=await getState();assert.equal(restored.connected,true);assert.equal(restored.lastKnownMode,'arm');assert.equal(restored.history.length,2);check('worker restart honors persisted backoff, restores session connection and re-verifies zone without duplicate history');
  await opened.click('#pm-disconnect');await until(async()=>(await getState()).connected===false,'disconnect');assert.equal((await getState()).mode,'unknown');
  assert.equal(await opened.evaluate(async()=>Object.hasOwn(await chrome.storage.session.get('precursor-credential:v1'),'precursor-credential:v1')),false);check('disconnect removes current mode and the session credential');
  phase='unauthorized';await opened.goto(opened.base+'options.html');const rejected=await opened.evaluate(()=>new Promise(resolve=>{const port=chrome.runtime.connect({name:'detect-expert-precursor-modes-v1'});port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;resolve(true);});setTimeout(()=>resolve(false),2000);}));assert.equal(rejected,true);check('other own extension page cannot access the settings control port');
  phase='layout';await opened.goto(opened.base+'precursor-settings.html');await opened.viewport(420,850);await opened.evaluate(()=>chrome.storage.local.set({'ui-language-v1':'ar'}));await until(()=>opened.evaluate(()=>document.documentElement.dir==='rtl'),'Arabic locale');
  assert.equal(await opened.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await opened.screenshot(join(out,'settings-chrome-ar.png'));check('Arabic RTL narrow settings layout has no horizontal overflow');
  assert.deepEqual(evidence.errors,[]);evidence.result='PASS';
}catch(error){evidence.result='FAIL';evidence.failure={phase,message:error.message};try{evidence.diagnostic={state:await getState(),ui:await opened.evaluate(async()=>({message:document.querySelector('#pm-message')?.textContent,notificationAccess:await chrome.permissions.contains({permissions:['notifications']})}))};await opened.screenshot(join(out,'settings-chrome-failure.png'));}catch{}throw error;}finally{writeFileSync(join(out,'native-chrome.json'),JSON.stringify(evidence,null,2));await opened?.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
