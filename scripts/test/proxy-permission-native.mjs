// ADR-070: genuine optional native grant after Proxy/SW startup; no Connect or external traffic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { registerOwnedProxyHost, createOwnedNativeHostName, isolateOwnedNativeBinding } from './proxy-native-host-fixture.mjs';
import { installPersistentChromeExtension, enableChromeUserScripts } from './api-custom-early-native.mjs';

const root=resolve(import.meta.dirname,'../..'),browser=process.argv.includes('--firefox')?'firefox':'chrome',denyFirst=process.argv.includes('--deny-first'),reloadExperiment=process.argv.includes('--reload-experiment'),normalInstall=process.argv.includes('--normal-install'),recoverNative=process.argv.includes('--recover-native');
const nativeHostName = createOwnedNativeHostName();
assert.ok(!(browser==='firefox'&&denyFirst),'Firefox helper has optional prompt UI disabled; denial is tested in interactive Chrome');
mkdirSync(join(root,'.tmp'),{recursive:true});
const run=mkdtempSync(join(root,'.tmp/proxy-permission-'+browser+'-')),extension=join(run,'extension');cpSync(join(root,'dist',browser),extension,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex'),files=['manifest.json','background.js','proxy-ui.js','proxy-ui.css','proxy-client.js','proxy-service.js','proxy-shared.js','management-ui.js','options.js','options.css'];
const evidence={at:new Date().toISOString(),browser,run,result:'RUNNING',freshProfile:true,optionalNativeNotPregranted:true,externalConnectionAttempted:false,userCredentialsRead:false,denyFirst,normalInstall,hashes:Object.fromEntries(files.map(file=>[file,sha(readFileSync(join(extension,file)))])),checks:[],attempts:[],screenshots:[]};
evidence.nativeHostBinding = isolateOwnedNativeBinding({ directory: extension, hostName: nativeHostName });
const bridge=[
  "import {createProxyClient} from './proxy-client.js';",
  "const api=globalThis.browser??globalThis.chrome,client=createProxyClient(api,{env:globalThis});",
  "window.__proxyPermission={clicks:[],visibility:[],async state(){return {native:await api.permissions.contains({permissions:['nativeMessaging']}),privacy:await api.permissions.contains({permissions:['privacy']}),method:typeof api.runtime.connectNative}},async readback(id){const value=await client.exportProfiles(id);try{const p=value.profiles[0];return {one:value.profiles.length===1,usernameMatches:p.connection.username==='OWNED_PERMISSION_USER',passwordMatches:p.connection.password==='OWNED_PERMISSION_PASSWORD',native:p.native}}finally{for(const p of value.profiles)for(const k of Object.keys(p.connection))p.connection[k]=null}},async storage(){return (await api.storage.local.get('proxy-configuration:v1'))['proxy-configuration:v1']??null}};",
  "addEventListener('click',event=>{if(event.target.closest('[data-proxy-save-profile]'))window.__proxyPermission.clicks.push({trusted:event.isTrusted,activation:navigator.userActivation?.isActive===true,nativeMethod:typeof api.runtime.connectNative})},true);",
  "document.addEventListener('visibilitychange',()=>window.__proxyPermission.visibility.push(document.visibilityState));",
].join('\n');
writeFileSync(join(extension,'proxy-permission-bridge.js'),bridge);evidence.fixtureBridgeSHA256=sha(bridge);
let opened,nativeFixture,phase='startup',monitor;
const check=text=>{evidence.checks.push(text);console.log('  ok '+text)};
const literal=value=>"'"+value.replaceAll("'","''")+"'";
function promptDecision(decision){
  if(browser!=='chrome')return {pending:Promise.resolve({nativePromptDisabledByOwnedFirefoxFixture:true}),stop(){}};
  const script="$ErrorActionPreference='Stop';Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;$owned=@(Get-CimInstance Win32_Process|Where-Object{$_.Name-eq'chrome.exe'-and$_.CommandLine-and$_.CommandLine.Contains("+literal(run)+")}|ForEach-Object{[int]$_.ProcessId});if($owned.Count-eq0){throw 'owned browser not found'};$deadline=[DateTime]::UtcNow.AddSeconds(25);$accept="+(decision==='accept'?'$true':'$false')+";do{foreach($pidValue in $owned){$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$pidValue);$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition);foreach($window in $windows){$buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button));foreach($button in $buttons){$name=$button.Current.Name;$match=if($accept){$name-match'^(Allow|Add permissions|Разрешить)$'}else{$name-match'^(Cancel|Deny|Отмена|Запретить)$'};if($match-and$button.Current.IsEnabled){$pattern=$null;if($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke();@{invoked=$true;decision="+literal(decision)+";button=$name}|ConvertTo-Json -Compress;exit 0}}}}};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow-lt$deadline);@{invoked=$false;decision="+literal(decision)+"}|ConvertTo-Json -Compress";
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let output='',error='';child.stdout.on('data',bytes=>{output+=bytes});child.stderr.on('data',bytes=>{error+=bytes});
  const pending=new Promise(resolve=>child.once('close',code=>{try{resolve(JSON.parse(output))}catch{resolve({invoked:false,code:code??null,probeError:error?'owned-ui-probe-failed':null})}}));
  return {pending,stop(){child.kill()}};
}
const field=key=>'[data-proxy-field="'+key+'"]';
const state=()=>opened.evaluate(()=>window.__proxyPermission.state());
async function bootBridge(){await opened.evaluate(()=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src=(globalThis.browser??globalThis.chrome).runtime.getURL('proxy-permission-bridge.js');script.onload=()=>resolve(true);script.onerror=()=>reject(Error('fixture-bridge'));document.head.append(script)}))}
async function capture(stage){const directory=join(root,'test-results/production-1.1.0/proxy');mkdirSync(directory,{recursive:true});await opened.evaluate(async()=>{document.activeElement?.blur?.();scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});const file='permission-'+browser+'-'+stage+'.png',path=join(directory,file);await opened.screenshot(path);evidence.screenshots.push({file,sha256:sha(readFileSync(path))})}
async function workerState(){if(browser!=='chrome')return null;return opened.context.serviceWorkers().find(worker=>worker.url().startsWith(opened.base)).evaluate(async()=>({method:typeof chrome.runtime.connectNative,native:await chrome.permissions.contains({permissions:['nativeMessaging']})}))}
async function fill(){for(const[key,value]of Object.entries({name:'Owned optional native grant',host:'127.0.0.1',port:'19081',username:'OWNED_PERMISSION_USER',password:'OWNED_PERMISSION_PASSWORD'}))await opened.fill(field(key),value)}
async function save(decision){
  monitor=promptDecision(decision);await opened.click('[data-proxy-save-profile]');
  await until(()=>opened.evaluate(()=>document.querySelector('[data-proxy-workspace]')?.getAttribute('aria-busy')==='false'&&(document.querySelector('[data-proxy-error]')||document.querySelector('[data-proxy-profile]'))),'Save settles',30000);
  const attempt=await opened.evaluate(async()=>({state:await window.__proxyPermission.state(),clicks:window.__proxyPermission.clicks,visibility:window.__proxyPermission.visibility,editor:Boolean(document.querySelector('[data-proxy-editor]')),error:document.querySelector('[data-proxy-diagnostic]')?.dataset.proxyDiagnostic??null,profiles:[...document.querySelectorAll('[data-proxy-profile]')].map(row=>row.dataset.proxyProfile),passwordBlank:document.querySelector('[data-proxy-field="password"]')?.value==='',usernameBlank:document.querySelector('[data-proxy-field="username"]')?.value===''}));
  attempt.worker=await workerState();monitor.stop();attempt.nativePrompt=await monitor.pending;monitor=null;evidence.attempts.push(attempt);return attempt;
}
try{
  const manifest=JSON.parse(readFileSync(join(extension,'manifest.json')));assert.ok(manifest.optional_permissions.includes('nativeMessaging'));assert.equal(manifest.permissions.includes('nativeMessaging'),false);
  if(browser==='chrome'&&normalInstall){
    const context=await chromium.launchPersistentContext(join(run,'normal-profile'),{channel:'chromium',headless:false,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1180,height:900},args:['--enable-unsafe-extension-debugging','--window-position=-10000,-10000','--no-first-run']});
    try{
      const keeper=await context.newPage();await keeper.goto('about:blank');
      const id=await installPersistentChromeExtension(context,extension,evidence),base='chrome-extension://'+id+'/';let page=await context.newPage();await page.goto(base+'options.html#proxy');page=await enableChromeUserScripts(context,page,id,evidence);
      opened={context,base,version:context.browser().version(),evaluate:(fn,value)=>page.evaluate(fn,value),goto:url=>page.goto(url),click:selector=>page.locator(selector).click(),fill:(selector,value)=>page.locator(selector).fill(value),screenshot:path=>page.screenshot({path,fullPage:true,animations:'disabled'}),close:()=>context.close()};
    }catch(error){await context.close();throw error}
  }else opened=await launchOwnedManagement({root,run,extension,browser,evidence,headless:false});
  evidence.version=opened.version;
  await opened.goto(opened.base+'options.html#proxy');await until(()=>opened.evaluate(()=>document.querySelector('[data-proxy-new]')?.disabled===false),'Proxy ready');
  await bootBridge();
  evidence.before=await state();evidence.workerBefore=await workerState();assert.equal(evidence.before.native,false);assert.equal(evidence.before.privacy,false);
  nativeFixture=await registerOwnedProxyHost({root,run,opened,browser,hostName:nativeHostName});evidence.host={sha256:nativeFixture.hash,isolatedVault:true,registryNamespaceIsolated:true};
  check('Proxy and SW are running before the first optional native grant; native/privacy are absent and the real host uses an isolated vault');
  await opened.click('[data-proxy-new]');await fill();
  phase=denyFirst?'trusted denial':'first optional grant';let attempt=await save(denyFirst?'deny':'accept');
  if(denyFirst){assert.equal(attempt.state.native,false);assert.equal(attempt.error,'permission-denied');assert.equal(attempt.profiles.length,0);assert.equal(attempt.passwordBlank,false);assert.equal(attempt.usernameBlank,false);check('trusted Save denial writes no metadata and retains the RAM draft; retry needs no re-entry');await capture('denied');phase='trusted retry after denial';attempt=await save('accept')}
  if(recoverNative&&browser==='chrome'){
    phase='explicit native restart recovery';assert.equal(normalInstall,true);assert.equal(attempt.error,'reconnect-required');assert.equal(attempt.state.native,true);assert.equal(attempt.state.privacy,false);assert.equal(attempt.passwordBlank,false);assert.equal(attempt.usernameBlank,false);assert.equal(attempt.profiles.length,0);assert.equal(attempt.worker.method,'undefined');
    await capture('restart-required');
    // A failed Save must show its alert and the restart action without a manual scroll: they are the last children of a scrolling sheet.
    const inView = await opened.evaluate(() => { const body = document.querySelector('.pm-sheet-body')?.getBoundingClientRect(), box = selector => document.querySelector(selector)?.getBoundingClientRect(); const inside = rect => Boolean(rect && body && rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1 && rect.bottom <= innerHeight + 1); return { error: inside(box('[data-proxy-error]')), restart: inside(box('[data-proxy-restart-native]')) }; });
    assert.deepEqual(inView, { error: true, restart: true }, 'the failed Save shows its alert and the restart action inside the visible sheet');evidence.errorInView=inView;
    const context=opened.context,oldPage=context.pages().find(page=>page.url().startsWith(opened.base+'options.html'));assert.ok(context.pages().some(page=>page.url()==='about:blank'),'a neutral keeper existed before the first Save');
    assert.equal(await opened.evaluate(()=>document.querySelector('[data-proxy-restart-native]')?.disabled),false);
    await opened.click('[data-proxy-restart-native]');
    let replacement;
    await until(async()=>{replacement=context.pages().find(page=>page!==oldPage&&page.url()===opened.base+'options.html#proxy');if(!replacement)return false;try{return await replacement.evaluate(()=>document.querySelector('[data-proxy-new]')?.disabled===false)}catch{return false}},'fixed own Options reopened after explicit restart',20000);
    evidence.recovery={oldPageClosed:oldPage.isClosed(),urlIsFixedOwnProxy:replacement.url()===opened.base+'options.html#proxy'};assert.equal(evidence.recovery.oldPageClosed,true);
    Object.assign(opened,{evaluate:(fn,value)=>replacement.evaluate(fn,value),goto:url=>replacement.goto(url),click:selector=>replacement.locator(selector).click(),fill:(selector,value)=>replacement.locator(selector).fill(value),screenshot:path=>replacement.screenshot({path,fullPage:true,animations:'disabled'})});await bootBridge();
    const afterBoot=await opened.evaluate(async()=>{const api=globalThis.chrome,data=await api.storage.local.get(['proxy-native-restart:v1','proxy-configuration:v1']);return {markerAbsent:data['proxy-native-restart:v1']===undefined,profileCount:data['proxy-configuration:v1']?.profiles?.length??0,editorAbsent:!document.querySelector('[data-proxy-editor]'),state:await window.__proxyPermission.state()}});
    assert.equal(afterBoot.markerAbsent,true);assert.equal(afterBoot.profileCount,0);assert.equal(afterBoot.editorAbsent,true);assert.equal(afterBoot.state.method,'function');assert.equal(afterBoot.state.native,true);assert.equal(afterBoot.state.privacy,false);evidence.recovery.afterBoot=afterBoot;evidence.recovery.worker=await workerState();assert.equal(evidence.recovery.worker.method,'function');
    check('explicit OFF-only restart consumes the nonsecret marker and reopens only fixed own Proxy with fresh native APIs and no retained editor or auto-save');
    await opened.click('[data-proxy-new]');await fill();attempt=await save('accept');
  }
  evidence.initialPermissionRequired=attempt.error==='permission-required'&&attempt.state.native;
  if(evidence.initialPermissionRequired){
    phase='one-second recovery probe';await pause(1000);evidence.afterDelay={options:await state(),worker:await workerState()};
    await opened.click('[data-proxy-panel="companion"]');await opened.click('[data-proxy-companion-check]');await until(()=>opened.evaluate(()=>document.querySelector('[data-proxy-workspace]').getAttribute('aria-busy')==='false'),'host retry');evidence.hostRetry=await opened.evaluate(()=>({available:document.querySelector('[data-proxy-companion-status]')?.dataset.proxyCompanionStatus,diagnostic:document.querySelector('[data-proxy-diagnostic]')?.dataset.proxyDiagnostic??null}));
    await opened.click('[data-proxy-panel="companion"]');await opened.click('[data-proxy-new]');await fill();attempt=await save('accept');
  }
  if(reloadExperiment&&browser==='chrome'&&evidence.initialPermissionRequired){
    phase='owned runtime reload experiment';const context=opened.context,oldPage=context.pages().find(page=>page.url().startsWith(opened.base+'options.html'));
    // Keep a neutral own tab open; otherwise closing the last extension page can end a disposable browser session.
    const keeper=await context.newPage();await keeper.goto('about:blank');evidence.reload={before:await workerState(),oldPageClosedBefore:oldPage.isClosed()};
    try{await oldPage.evaluate(()=>{window.setTimeout(()=>location.reload(),500);chrome.runtime.reload();return true})}catch{evidence.reload.evaluationInterrupted=true}
    await pause(1500);evidence.reload.oldPageClosedAfter=oldPage.isClosed();evidence.reload.optionsPagesAfterTimer=context.pages().filter(page=>page.url().startsWith(opened.base+'options.html')).length;
    const page=oldPage.isClosed()?await context.newPage():oldPage;
    Object.assign(opened,{evaluate:(fn,value)=>page.evaluate(fn,value),goto:url=>page.goto(url),click:selector=>page.locator(selector).click(),fill:(selector,value)=>page.locator(selector).fill(value),screenshot:path=>page.screenshot({path,fullPage:true})});
    if(oldPage.isClosed()||!page.url().startsWith(opened.base+'options.html'))await opened.goto(opened.base+'options.html#proxy');
    await until(()=>opened.evaluate(()=>document.querySelector('[data-proxy-new]')?.disabled===false),'fresh namespace after runtime reload');
    await bootBridge();
    evidence.reload.after={options:await state(),worker:await workerState()};
    await opened.click('[data-proxy-new]');await fill();attempt=await save('accept');
  }
  assert.equal(attempt.state.native,true);assert.equal(attempt.state.privacy,false);assert.equal(attempt.profiles.length,1,'native grant must permit Save without privacy or worker restart (Save error: '+attempt.error+(attempt.error==='reconnect-required'?'; a live Chrome keeps connectNative missing after the first grant, run it with --normal-install --recover-native, ADR-070 E22-27':'')+')');assert.equal(attempt.error,null);assert.equal(attempt.editor,false);assert.ok(attempt.clicks.every(click=>click.trusted&&click.activation));
  const stored=await opened.evaluate(()=>window.__proxyPermission.storage());assert.equal(stored.enabled,false);assert.equal(stored.profiles[0].native,true);assert.doesNotMatch(JSON.stringify(stored),/OWNED_PERMISSION_USER|OWNED_PERMISSION_PASSWORD/);
  const readback=await opened.evaluate(id=>window.__proxyPermission.readback(id),stored.profiles[0].id);assert.deepEqual(readback,{one:true,usernameMatches:true,passwordMatches:true,native:true});evidence.readback=readback;
  check('trusted optional-grant Save persists metadata only and the isolated vault readback matches dummy credentials while OFF');
  await capture('saved');
  await opened.goto(opened.base+'options.html#proxy');await until(()=>opened.evaluate(()=>document.querySelectorAll('[data-proxy-profile]').length===1),'metadata survives Options reload');
  check('the saved native profile survives a new Options document without Connect, Check or external traffic');
  if(!reloadExperiment)assert.equal(evidence.initialPermissionRequired,false,'first grant caused permission-required before later recovery');
  evidence.result='PASS';console.log('PASS optional native Proxy '+browser+': '+evidence.checks.length+' checks');
}catch(error){evidence.result='FAIL';evidence.phase=phase;evidence.error=error.message;if(opened)try{await opened.screenshot(join(run,'failed.png'))}catch{}throw error}
finally{try{monitor?.stop();if(opened)await opened.close()}finally{try{nativeFixture?.restore();if(nativeFixture)evidence.registryRestored=true}finally{const directory=join(root,'test-results/production-1.1.0/proxy');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'permission-'+browser+(denyFirst?'-deny':'')+(reloadExperiment?'-reload':'')+(recoverNative?'-recovery':'')+'.json'),JSON.stringify(evidence,null,2)+'\n')}}}
