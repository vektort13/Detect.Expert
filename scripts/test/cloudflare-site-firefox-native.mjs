// Exact user-provided public demo, native Firefox, disposable profile.
// No production challenge interaction, response/token input reads or automation hiding.
// --test-clicks allows one native pointer click only for the exact documented dummy key.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';

const root = resolve(import.meta.dirname, '../..'), target = 'https://2captcha.com/demo/cloudflare-turnstile';
const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/firefox'));
const elementClicks = process.argv.includes('--element-clicks');
const testClicks = process.argv.includes('--test-clicks') || elementClicks;
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/observer-compatibility/cloudflare-site-firefox.json'));
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
assert.ok(existsSync(driverPath), 'Use the already installed native driver; no download');
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding:'utf8', windowsHide:true }).stdout.trim();
assert.ok(binary, 'Installed Firefox is required');
mkdirSync(join(root,'.tmp'), {recursive:true});
const run = mkdtempSync(join(root,'.tmp/cloudflare-site-firefox-')), profile = join(run,'profile'), extension = join(run,'extension');
cpSync(input,extension,{recursive:true}); mkdirSync(profile);
const uuid=randomUUID(), base='moz-extension://'+uuid+'/';
const prefs={ 'extensions.webextensions.uuids':JSON.stringify({[FIREFOX_ID]:uuid}), 'browser.shell.checkDefaultBrowser':false,
  'browser.startup.homepage_override.mstone':'ignore','browser.startup.page':0,'browser.newtabpage.enabled':false,
  'datareporting.policy.dataSubmissionEnabled':false,'toolkit.telemetry.enabled':false,'app.update.auto':false,
  'network.proxy.type':0,'network.dns.disablePrefetch':true,'extensions.webextOptionalPermissionPrompts':false,
  'browser.cache.memory.enable':false,'browser.cache.disk.enable':false };
writeFileSync(join(profile,'user.js'),Object.entries(prefs).map(([key,value])=>'user_pref('+JSON.stringify(key)+', '+JSON.stringify(value)+');').join('\n'));
const evidence={at:new Date().toISOString(),result:'RUNNING',scope:testClicks?'Exact public demo; at most one ordinary pointer click on the documented 3xFF dummy checkbox, no production challenge interaction':'Exact public demo observed without CAPTCHA interaction; challenge completion is not asserted',
  target,run,input,testClicks,elementClicks,browser:null,hashes:Object.fromEntries(['manifest.json','background.js','hook.early.js','hook.main.js','api-configuration-controller.js','vendor-redirects.js']
    .map(name=>[name,createHash('sha256').update(readFileSync(join(extension,name))).digest('hex')])),modes:[],failures:[]};
let endpoint,session,driver,driverError,socket,settingsHandle,pageHandle,tabId,active,phase='baseline';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(probe,label,milliseconds=15000){const end=Date.now()+milliseconds;while(Date.now()<end){const value=await probe();if(value)return value;await pause(100);}throw Error(label);}
async function command(path,body,method='POST'){
  const response=await fetch(endpoint+path,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),signal:AbortSignal.timeout(45000)});
  const value=(await response.json()).value;if(!response.ok||typeof value?.error==='string')throw Error('WebDriver '+(value?.error??response.status));return value;
}
const wd=(path,body,method)=>command('/session/'+session+path,body,method);
const script=(source,args=[])=>wd('/execute/sync',{script:source,args});
const asyncScript=(source,args=[])=>wd('/execute/async',{script:source,args});
const send=async message=>{await wd('/window',{handle:settingsHandle});return asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,()=>done({type:"test-send-error"}));',[{schemaVersion:1,...message}]);};
function safeResource(raw){
  try{const url=new URL(raw);return {host:url.hostname,path:url.hostname==='2captcha.com'&&url.pathname==='/demo/cloudflare-turnstile'?'/demo/cloudflare-turnstile':
    url.hostname==='challenges.cloudflare.com'&&url.pathname==='/turnstile/v0/api.js'?'/turnstile/v0/api.js':
    url.hostname==='challenges.cloudflare.com'&&url.pathname.startsWith('/cdn-cgi/challenge-platform/')?'/cdn-cgi/challenge-platform/…':'/other'};}
  catch{return {host:'non-http',path:'/'};}
}
let bidiSequence=0;const bidiPending=new Map();
function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++bidiSequence,timer=setTimeout(()=>{bidiPending.delete(id);reject(Error('BiDi '+method+' timed out'));},10000);bidiPending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function connectBidi(address){
  assert.equal(typeof address,'string');socket=new WebSocket(address);
  await Promise.race([new Promise((done,reject)=>{socket.onopen=done;socket.onerror=()=>reject(Error('BiDi unavailable'));}),pause(4000).then(()=>{throw Error('BiDi connection timeout');})]);
  socket.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.id){const job=bidiPending.get(message.id);if(!job)return;bidiPending.delete(message.id);clearTimeout(job.timer);message.type==='error'?job.reject(Error('BiDi '+message.error)):job.resolve(message.result);return;}
    if(!active)return;
    if(message.method==='log.entryAdded'){const entry=message.params;if(entry?.level==='error'&&active.errors.length<24)active.errors.push({type:entry.type??'unknown',level:'error'});return;}
    if(!['network.responseStarted','network.responseCompleted','network.fetchError'].includes(message.method))return;
    const raw=message.params?.request?.url;if(typeof raw!=='string'||!/^https?:/.test(raw))return;
    const safe=safeResource(raw),status=message.method==='network.fetchError'?'request-failed':message.params?.response?.status;
    if(typeof status!=='number'&&status!=='request-failed')return;
    const key=safe.host+safe.path+status,row=active.resources.get(key)??{...safe,status,count:0};
    if(active.resources.size<128||active.resources.has(key)){row.count=Math.min(65535,row.count+1);active.resources.set(key,row);}
  };
  await rpc('session.subscribe',{events:['network.responseStarted','network.responseCompleted','network.fetchError','log.entryAdded']});
}
const factsExpression=`JSON.stringify((()=>({readyState:document.readyState,sdkGlobal:typeof window.turnstile==='object',
  viewport:{width:innerWidth,height:innerHeight},
  iframeCount:document.querySelectorAll('iframe').length,challengeIframeCountDOM:[...document.querySelectorAll('iframe')].filter(frame=>{try{return new URL(frame.src).hostname==='challenges.cloudflare.com'}catch{return false}}).length,
  widgetContainerCount:document.querySelectorAll('.cf-turnstile,[data-sitekey]').length,cpuCustom16:navigator.hardwareConcurrency===16,
  cpuGetterWrapped:(()=>{const getter=Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency')?.get;return typeof getter==='function'&&!Function.prototype.toString.call(getter).includes('[native code]')})(),
  interactiveTestKey:[...document.querySelectorAll('[data-sitekey]')].some(element=>element.getAttribute('data-sitekey')==='3x00000000000000000000FF'),
  userAgentWithheld:typeof navigator.userAgent==='undefined',webdriver:navigator.webdriver,
  proMathWrapped:!Function.prototype.toString.call(Math.sin).includes('[native code]') }))())`;
async function evaluate(context,expression){const response=await rpc('script.evaluate',{expression,target:{context},awaitPromise:false});if(response.type!=='success'||response.result?.type!=='string')throw Error('BiDi controlled facts unavailable');return JSON.parse(response.result.value);}
async function pageFacts(){
  const tree=await rpc('browsingContext.getTree',{}),top=tree.contexts.find(row=>row.context===pageHandle||row.url===target);assert.ok(top,'Native top page context');
  const frames=[];const walk=row=>{for(const child of row.children??[]){frames.push(child);walk(child);}};walk(top);
  const cfFrames=frames.filter(row=>{try{return new URL(row.url).hostname==='challenges.cloudflare.com';}catch{return false;}});
  const facts=await evaluate(top.context,factsExpression);facts.nativeChallengeFrames=cfFrames.length;
  facts.nativeFrameInteractiveTestKey=cfFrames.some(frame=>{try{return new URL(frame.url).pathname.split('/').includes('3x00000000000000000000FF');}catch{return false;}});
  facts.widgetStates=[];facts.visibleTestingOnly=false;
  // Read only the presence of four known UI strings. No challenge result input,
  // callback argument, arbitrary body text or response payload is accessed.
  for(const frame of cfFrames.slice(0,8)){
    try{const state=await evaluate(frame.context,`JSON.stringify((()=>{const text=document.body?.innerText?.toLowerCase()??'';for(const [id,label] of [['success','success!'],['failure','failure!'],['interactive','verify you are human'],['verifying','verifying']]){if(text.includes(label))return id;}return 'unknown';})())`);facts.widgetStates.push(state);
      const testing=await evaluate(frame.context,`JSON.stringify((()=>{const nodes=document.evaluate('//*[normalize-space(.)="For testing only"]',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(let i=0;i<Math.min(nodes.snapshotLength,256);++i){const el=nodes.snapshotItem(i),rect=el.getBoundingClientRect(),style=getComputedStyle(el);if(rect.width>0&&rect.height>0&&style.visibility==='visible'&&style.display!=='none')return true;}return false;})())`);facts.visibleTestingOnly ||= testing;}
    catch{facts.widgetStates.push('unavailable');}
  }
  return facts;
}
async function metadata(){
  const [scope,api,pro]=await Promise.all([send({type:'ui-get-scope'}),send({type:'ui-api-config-get',tabId:null}),send({type:'ui-pro-get'})]);
  return {observation:scope.scope?.scopeMode,api:{enabled:api.configuration?.enabled,antidetectEnabled:api.configuration?.antidetectEnabled,revision:api.revision,registration:api.registration,earlyAccess:api.earlyAccess},proRecording:pro.session?.status==='recording',firewall:{supported:false,reason:'Firefox build has no Firewall module'}};
}
async function actualReport(){
  const response=await send({type:'ui-get-report',tabId});const report=response.report;
  if(!report)return {type:response.type,report:null};
  return {type:response.type,report:{documentKey:report.documentKey,coverageState:report.coverageState,coverageFlags:report.coverageFlags,
    techniques:report.techniques.map(({techniqueId,count})=>({techniqueId,count})),vendors:report.vendors}};
}
async function screenshot(name){await wd('/window',{handle:pageHandle});const png=await wd('/screenshot',undefined,'GET');const path=join(resolve(artifact,'..'),'cloudflare-site-firefox-'+name+'.png');writeFileSync(path,Buffer.from(png,'base64'));return path;}
async function nativePointerClick(point){
  await wd('/actions',{actions:[{type:'pointer',id:'documented-dummy-checkbox',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x:point.x,y:point.y},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
  await wd('/actions',undefined,'DELETE');
}
async function observe(mode,{long=false}={}){
  phase=mode;const record={mode,metadata:settingsHandle?await metadata():null};evidence.modes.push(record);console.log('mode '+mode);
  if(record.metadata){assert.equal(record.metadata.observation,mode==='installed-observation-off'?'off':'all-sites');
    assert.equal(record.metadata.api.enabled,['api-enabled-empty-bypass','api-all-off','hardware16-custom','intentional-user-agent-on'].includes(mode));
    assert.equal(record.metadata.api.antidetectEnabled,mode==='hardware16-custom');
    if(mode==='hardware16-custom')assert.equal(record.metadata.api.registration,'ready','Custom must have a real active native registration');
    assert.equal(record.metadata.proRecording,mode==='pro-recording');assert.notEqual(record.metadata.api.registration,'error');}
  active={resources:new Map(),errors:[]};await wd('/window',{handle:pageHandle});const started=Date.now();
  await wd('/url',{url:target});await pause(Math.max(0,12000-(Date.now()-started)));
  record.seconds12=await pageFacts();record.elapsed12Ms=Date.now()-started;
  if(['baseline','installed-observation-off','light','pro-recording'].includes(mode))record.screenshot12=await screenshot(mode+'-12s');
  if(settingsHandle)record.analysis12=await actualReport();
  if(mode==='pro-recording'){
    const response=await send({type:'ui-pro-get',tabId}),page=response.session?.pages?.find(row=>row.tabId===tabId&&row.documentKey===record.analysis12.report?.documentKey&&row.endedAt===null);
    record.pro={recording:response.session?.status==='recording',tracked:Boolean(page),reports:page?.reports.length??0,apiValueDocuments:page?.apiValues?.length??0};
    assert.equal(record.pro.recording,true);assert.equal(record.pro.tracked,true);assert.equal(record.seconds12.proMathWrapped,true);
  }
  if(mode==='hardware16-custom')assert.equal(record.seconds12.cpuCustom16,true,'Selected CPU metadata must actually be applied');
  // cpuGetterWrapped is diagnostic only: ordinary Light observation wraps it too.
  if(mode==='intentional-user-agent-on')assert.equal(record.seconds12.userAgentWithheld,true,'Diagnostic blocking mode must actually apply');
  if(mode==='baseline')assert.equal(record.seconds12.webdriver,true,'Automation remains visible');
  if(long){await pause(Math.max(0,30000-(Date.now()-started)));record.seconds30=await pageFacts();record.elapsed30Ms=Date.now()-started;record.screenshot30=await screenshot(mode+'-30s');record.analysis30=await actualReport();}
  if(testClicks){
    record.testInteraction={attempted:false,reason:'Exact documented dummy key in both container and native Cloudflare frame, plus unobstructed widget bounds, must be confirmed'};
    if(record.seconds12.interactiveTestKey&&record.seconds12.nativeFrameInteractiveTestKey&&record.seconds12.nativeChallengeFrames===1){
      await wd('/window',{handle:pageHandle});
      const tree=await rpc('browsingContext.getTree',{}),top=tree.contexts.find(row=>row.context===pageHandle||row.url===target);assert.ok(top);
      const point=await evaluate(top.context,`JSON.stringify((()=>{const matches=[...document.querySelectorAll('[data-sitekey]')].filter(el=>el.getAttribute('data-sitekey')==='3x00000000000000000000FF');if(matches.length!==1)return null;const el=matches[0],box=el.getBoundingClientRect(),x=Math.round(box.left+20),y=Math.round(box.top+box.height/2),hit=document.elementFromPoint(x,y);if(box.width<200||box.width>500||box.height<40||box.height>150||x<0||y<0||x>=innerWidth||y>=innerHeight||!(hit===el||el.contains(hit)))return null;return {x,y,width:box.width,height:box.height};})())`);
      if(point){
        if(elementClicks){
          record.nativeFrameLookup=[];
          try{
            for(let index=0;index<Math.min(top.children?.length??0,8);++index){
              await wd('/frame',{id:null});
              try{await wd('/frame',{id:index});}catch{record.nativeFrameLookup.push({index,entered:false});continue;}
              const host=await script('return location.hostname;');
              if(host!=='challenges.cloudflare.com'){record.nativeFrameLookup.push({index,entered:true,cloudflare:false});continue;}
              const inputs=await wd('/elements',{using:'css selector',value:'input[type="checkbox"]'}),roles=await wd('/elements',{using:'css selector',value:'[role="checkbox"]'});
              record.nativeFrameLookup.push({index,entered:true,cloudflare:true,inputCheckboxCount:inputs.length,roleCheckboxCount:roles.length});
              const candidates=inputs.length===1?inputs:roles.length===1?roles:[];
              if(candidates.length===1){record.testInteraction={attempted:true,clicks:1,kind:'native-element-click-documented-dummy-checkbox'};await wd('/element/'+candidates[0]['element-6066-11e4-a52e-4f735466cecf']+'/click',{});}
              else record.testInteraction.reason='Native Cloudflare frame has no single accessible checkbox element; no click attempted';
              break;
            }
          }finally{await wd('/frame',{id:null});}
        }else{await nativePointerClick(point);record.testInteraction={attempted:true,clicks:1,kind:'native-pointer-documented-dummy-checkbox',point};}
        if(record.testInteraction.attempted){const clicked=Date.now();await pause(2000);record.afterTestClick2=await pageFacts();record.screenshotAfterClick2=await screenshot(mode+'-dummy-click-2s');
          await pause(Math.max(0,10000-(Date.now()-clicked)));record.afterTestClick10=await pageFacts();record.screenshotAfterClick=await screenshot(mode+'-dummy-click-10s');
          if(record.afterTestClick10.widgetStates.some(state=>state==='verifying')){await pause(Math.max(0,30000-(Date.now()-clicked)));record.afterTestClick30=await pageFacts();record.screenshotAfterClick30=await screenshot(mode+'-dummy-click-30s');}}
      }else record.testInteraction.reason='Dummy widget bounds or hit target not confirmed; no click attempted';
    }
  }
  record.resources=[...active.resources.values()];record.pageErrors=active.errors;active=null;
  console.log('  observed '+JSON.stringify({sdk:record.seconds12.sdkGlobal,frames:record.seconds12.nativeChallengeFrames,states:record.seconds12.widgetStates,coverage:record.analysis12?.report?.coverageState}));
}
async function setApi(enabled,mode='bypass',id=null){const state=await send({type:'ui-api-config-get',tabId:null});
  const configuration={...state.configuration,enabled,antidetectEnabled:enabled&&mode==='custom',preset:'custom',sites:[],apis:state.configuration.apis.map(row=>({...row,mode:id===null?mode:row.id===id?mode:'bypass',selected:row.id===id&&mode==='custom'?{kind:'value',value:16}:{kind:'unset'}}))};
  const saved=await send({type:'ui-api-config-set',tabId:null,expectedRevision:state.revision,configuration});assert.equal(saved.type,'api-config-state');assert.notEqual(saved.registration,'error');
  assert.equal(saved.configuration.enabled,enabled);assert.equal(saved.configuration.antidetectEnabled,enabled&&mode==='custom');return saved;}
try{
  mkdirSync(resolve(artifact,'..'),{recursive:true});
  const ports=await Promise.all(Array.from({length:2},async()=>{const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));return {server,port:server.address().port};}));
  const [port,bidiPort]=ports.map(row=>row.port);await Promise.all(ports.map(row=>new Promise(done=>row.server.close(done))));endpoint='http://127.0.0.1:'+port;evidence.bidiPort=bidiPort;
  driver=spawn(driverPath,['--host','127.0.0.1','--port',String(port),'--websocket-port',String(bidiPort),'--profile-root',run,'--log','error'],{cwd:root,windowsHide:true,stdio:'ignore'});driver.once('error',error=>{driverError=error;});
  await until(async()=>{if(driverError)throw driverError;try{return await command('/status',undefined,'GET');}catch{return false;}},'Native driver readiness');
  const opened=await command('/session',{capabilities:{alwaysMatch:{browserName:'firefox',pageLoadStrategy:'eager',webSocketUrl:true,'moz:firefoxOptions':{binary,args:['-headless','-no-remote','-profile',profile]}}}});
  session=opened.sessionId;evidence.browser=opened.capabilities.browserVersion;await wd('/timeouts',{script:15000,pageLoad:45000});await wd('/window/rect',{width:1280,height:960});pageHandle=await wd('/window',undefined,'GET');await connectBidi(opened.capabilities.webSocketUrl);
  if(testClicks){
    const owned='<!doctype html><button id="owned" style="position:fixed;left:355px;top:365px;width:40px;height:40px">Test</button><script>window.pointerProof={clicks:0,trusted:false};document.querySelector("button").addEventListener("click",event=>{window.pointerProof={clicks:window.pointerProof.clicks+1,trusted:event.isTrusted,x:event.clientX,y:event.clientY}})</script>';
    await wd('/url',{url:'data:text/html,'+encodeURIComponent(owned)});await nativePointerClick({x:375,y:385});await pause(100);
    evidence.ownedPointerControl=await script('return window.pointerProof;');assert.equal(evidence.ownedPointerControl.clicks,1);assert.equal(evidence.ownedPointerControl.trusted,true);
  }
  await observe('baseline');
  const archive=join(run,'detect-expert-site.xpi');writeFileSync(archive,archiveProduction(extension));assert.equal(await wd('/moz/addon/install',{path:archive,temporary:true}),FIREFOX_ID);
  settingsHandle=(await wd('/window/new',{type:'tab'})).handle;await wd('/window',{handle:settingsHandle});await wd('/url',{url:base+'options.html#api'});
  await until(()=>script('return Boolean(document.querySelector("[data-api-early-grant]"));'),'Native optional permission button');const grant=await wd('/element',{using:'css selector',value:'[data-api-early-grant]'});await wd('/element/'+grant['element-6066-11e4-a52e-4f735466cecf']+'/click',{});
  await until(async()=>(await send({type:'ui-api-config-get',tabId:null})).earlyAccess==='ready','Optional userScripts actually granted');
  tabId=await asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({}).then(rows=>done(rows.find(row=>row.url===arguments[0])?.id));',[target]);assert.ok(Number.isSafeInteger(tabId));
  assert.equal((await send({type:'ui-data-consent-set',version:1,accepted:true})).accepted,true);assert.equal((await send({type:'ui-set-scope',scopeMode:'off'})).type,'scope');await setApi(false);if(!testClicks)await observe('installed-observation-off');
  assert.equal((await send({type:'ui-set-scope',scopeMode:'all-sites'})).type,'scope');await observe('light',{long:!testClicks});
  const pro=await send({type:'ui-pro-start',tabId});assert.equal(pro.session?.status,'recording');await observe('pro-recording');await send({type:'ui-pro-stop',sessionId:pro.session.id});
  if(!testClicks){await setApi(true);await observe('api-enabled-empty-bypass');await setApi(true,'off');await observe('api-all-off');await setApi(true,'custom','hardware-concurrency');await observe('hardware16-custom');await setApi(true,'on','navigator-user-agent');await observe('intentional-user-agent-on');}
  await setApi(false);await send({type:'ui-set-scope',scopeMode:'off'});evidence.finalMetadata=await metadata();assert.equal(evidence.modes.length,testClicks?3:8);evidence.result='OBSERVED';
}catch(error){evidence.result='FAIL';evidence.failure={phase,name:error.name,message:String(error.message).replace(/https?:\/\/\S+/g,'[URL omitted]').slice(0,250)};console.error(JSON.stringify(evidence.failure));process.exitCode=1;}
finally{socket?.close();if(session)await command('/session/'+session,undefined,'DELETE').catch(()=>{});driver?.kill();for(const job of bidiPending.values())clearTimeout(job.timer);bidiPending.clear();mkdirSync(resolve(artifact,'..'),{recursive:true});writeFileSync(artifact,JSON.stringify(evidence,null,2)+'\n');console.log(evidence.result+': '+artifact);}
