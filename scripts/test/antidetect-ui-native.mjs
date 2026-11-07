// ADR-064: actual management UI and early registered guards in disposable browser profiles.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/antidetect-ui-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const files = ['antidetect-controller.js','antidetect-ui.js','antidetect-ui.css','api-custom-registration.js','api-configuration-ui.js','api-configuration.js','management-ui.js','management-ui.css','options.js'];
const evidence = { browser, run, at: new Date().toISOString(), result:'RUNNING', checks:[], layouts:[], hashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(extension,file))).digest('hex')])) };

const server=createServer((request,response)=>{request.resume();response.setHeader('Content-Type','text/html');response.end('<!doctype html><script>window.__antidetectFirst={rtc:typeof RTCPeerConnection,ws:typeof WebSocket,wt:typeof WebTransport,cpu:navigator.hardwareConcurrency};const f=document.createElement("iframe");document.documentElement.append(f);window.__antidetectFirst.childRtc=typeof f.contentWindow.RTCPeerConnection;window.__antidetectFirst.childWs=typeof f.contentWindow.WebSocket;window.postMessage({channel:"detect.expert/protection/v1",type:"protection-stop"},"*");queueMicrotask(()=>window.postMessage({channel:"detect.expert/protection/v1",type:"protection-stop"},"*"));setTimeout(()=>{window.__antidetectFirst.afterStopRtc=typeof RTCPeerConnection;window.__antidetectFirst.afterStopWs=typeof WebSocket;window.__antidetectFirst.stopDone=true;},100);</script><h1>Owned Antidetect fixture</h1>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(probe,label,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await probe();if(value)return value;await pause(40);}throw Error('timeout: '+label);}
const check=text=>{evidence.checks.push(text);console.log('  ok '+text);};
let opened,phase='startup';
async function launch(extension, label) {
  const profile = join(run, label + '-profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    // Native system.display.getInfo crashes Chromium 153's headless process in a bare MV3 fixture.
    // A normal off-screen window exercises the real supported desktop API, without a foreground lab window.
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const base = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length) + 1);
    let page = await context.newPage(); await page.goto(base + 'options.html#settings'); page = await enableChromeUserScripts(context, page, new URL(base).host, evidence);
    return { version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), fill: (selector, value) => page.locator(selector).fill(value),
      screenshot: path => page.screenshot({ path, fullPage: true }), viewport: (width, height) => page.setViewportSize({ width, height }), media: options => page.emulateMedia(options), close: () => context.close() };
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary is required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, label + '-geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error((value?.error ?? 'WebDriver error') + ': ' + (value?.message ?? path)); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
  let session;
  try {
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method);
    const xpi = join(run, label + '.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
    const element = async selector => (await wd('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/',
      evaluate: async (fn, value) => { const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!result.ok) throw Error(result.error); return result.value; },
      goto: url => wd('/url', { url }), click: async selector => {
        // Route restoration runs on the next frame; wait for the actual native hit target.
        await until(() => wd('/execute/async', { script: 'const element=document.querySelector(arguments[0]),done=arguments[arguments.length-1];if(!element){done(false);return;}element.scrollIntoView({block:"center",behavior:"instant"});requestAnimationFrame(()=>requestAnimationFrame(()=>{const box=element.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;done(box.width>0&&box.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&element.contains(document.elementFromPoint(x,y)));}));', args: [selector] }), 'native click target ' + selector);
        return wd('/element/' + await element(selector) + '/click', {});
      }, fill: async (selector, text) => { const id = await element(selector); await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text, value: [...text] }); },
      screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), viewport: (width, height) => wd('/window/rect', { width, height }), media: async () => {},
      close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}

const evaluate=(fn,value)=>opened.evaluate(fn,value);
const send=message=>evaluate(message=>(globalThis.browser??globalThis.chrome).runtime.sendMessage({schemaVersion:1,...message}),message);
const state=()=>send({type:'ui-api-config-get',tabId:null});
const select=(selector,value)=>evaluate(({selector,value})=>{const field=document.querySelector(selector);if(!field)throw Error('missing field '+selector);field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));return true;},{selector,value});
const ready=()=>until(()=>evaluate(()=>document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy')==='false'&&Boolean(document.querySelector('[data-antidetect-master]'))),'Antidetect ready');
async function save(){await opened.click('[data-antidetect-save]');await ready();const error=await evaluate(()=>document.querySelector('[data-antidetect-error]')?.textContent);assert.ok(!error,error);return state();}
async function probe(){return evaluate(async origin=>{const api=globalThis.browser??globalThis.chrome,url=origin+'/probe?'+Math.random(),tab=await api.tabs.create({url,active:false});try{for(let i=0;i<100;i++){const current=await api.tabs.get(tab.id);if(current.status!=='complete'||current.url!==url){await new Promise(done=>setTimeout(done,30));continue;}const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>globalThis.__antidetectFirst??null});if(result[0]?.result?.stopDone)return result[0].result;await new Promise(done=>setTimeout(done,30));}throw Error('probe-timeout');}finally{await api.tabs.remove(tab.id);}},origin);}
try{
 opened=await launch(extension,'native'); evidence.version=opened.version;
 await opened.goto(opened.base+'options.html#settings');
 await until(()=>evaluate(()=>Boolean(document.querySelector('[data-management-shell]'))),'management mount');
 await send({type:'ui-data-consent-set',version:1,accepted:true});await send({type:'ui-set-scope',scopeMode:'all-sites'});
 await opened.goto(opened.base+'options.html#antidetect');await ready();
 if(browser==='firefox'){await opened.click('[data-antidetect-grant-early]');await ready();assert.equal((await state()).earlyAccess,'ready');}
 const before=await state();
 assert.deepEqual(await evaluate(()=>[...document.querySelectorAll('[data-antidetect-category]')].map(e=>e.dataset.antidetectCategory)),['quick','device','os','browser','network']); // ADR-104: quick setup, then the four levels
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-category="network"]').getAttribute('aria-selected')),'true');
 assert.equal((await state()).revision,before.revision);assert.equal(before.configuration.enabled,false);assert.equal(before.configuration.antidetectEnabled,false);
 check('Antidetect opens Network in the required quick-setup + four-level order without saving or enabling either master');
 phase='horizontal category navigation';
 const sidebar=await evaluate(()=>{const nav=document.querySelector('[data-antidetect-navigation]'),main=document.querySelector('[data-antidetect-main]'),buttons=[...nav.querySelectorAll('[role="tab"]')],rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};return {orientation:nav.getAttribute('aria-orientation'),display:getComputedStyle(nav).display,nav:rect(nav),main:rect(main),buttons:buttons.map(e=>({rect:rect(e),color:getComputedStyle(e.querySelector('.antidetect-icon')).color,svg:!!e.querySelector('svg path')}))};});
 assert.equal(sidebar.orientation,'horizontal');assert.equal(sidebar.display,'flex');assert.ok(sidebar.nav.width>=sidebar.main.width-1);assert.ok(sidebar.main.top>=sidebar.nav.bottom);
 assert.equal(new Set(sidebar.buttons.map(row=>row.color)).size,5);assert.ok(sidebar.buttons.every(row=>row.svg&&row.rect.left>=sidebar.nav.left-1&&row.rect.right<=sidebar.nav.right+1));
 for(const [key,category]of [['Home','quick'],['ArrowDown','device'],['End','network'],['ArrowDown','quick'],['ArrowUp','network']]){await evaluate(key=>document.querySelector('[data-antidetect-category][aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})),key);await until(()=>evaluate(category=>document.querySelector('[data-antidetect-category="'+category+'"]').getAttribute('aria-selected')==='true'&&document.activeElement?.dataset.antidetectCategory===category,category),'focused category '+category);}
 await opened.click('[data-antidetect-category="network"]');assert.equal((await state()).revision,before.revision);
 check('five independently colored SVG categories wrap above the editor; arrow/Home/End navigation moves selection and actual focus without saving');
 phase='spoof draft and persistence';
 await opened.click('[data-antidetect-mode="webrtc:spoof"]');await opened.click('[data-antidetect-addresses-enabled]');
 for(const [key,value]of Object.entries({'ipv4:host':'192.0.2.10','ipv4:stun':'198.51.100.20','ipv4:turn':'203.0.113.30'}))await opened.fill('[data-antidetect-address="'+key+'"]',value);
 await opened.click('[data-antidetect-mapped-ipv6]');
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-address="ipv6:stun"]').value),'::ffff:c633:6414');
 await opened.click('[data-antidetect-dtls]');
 await select('[data-antidetect-device-mode]','custom');await opened.click('[data-antidetect-device-add]');
 await opened.fill('[data-antidetect-device-field="0:deviceId"]','owned-test-mic');await opened.fill('[data-antidetect-device-field="0:label"]','Owned microphone');
 await opened.click('[data-antidetect-category="device"]');await until(()=>evaluate(()=>Boolean(document.querySelector('.antidetect-api [data-api-configuration-editor]'))),'device editor');
 assert.ok(await evaluate(()=>document.querySelector('.antidetect-api [data-protection-feature="hardware-concurrency"]')));assert.equal(await evaluate(()=>document.querySelectorAll('[data-antidetect-app] [role="switch"]').length),1,'embedded editor has one Antidetect master');
 await opened.click('[data-management-tab="contacts"]');await opened.click('[data-management-tab="antidetect"]');await opened.click('[data-antidetect-category="network"]');
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-address="ipv4:stun"]').value),'198.51.100.20');assert.equal((await state()).revision,before.revision);
 const spoof=await save();assert.equal(spoof.configuration.enabled,false);assert.equal(spoof.configuration.antidetectEnabled,false);const rtc=spoof.configuration.apis.find(row=>row.id==='webrtc');
 assert.equal(rtc.mode,'custom');assert.equal(rtc.selected.value.addresses.ipv6.turn,'::ffff:cb00:711e');assert.equal(spoof.configuration.apis.find(row=>row.id==='media-enumeration').mode,'custom');
 assert.equal((await probe()).rtc,'function');
 check('dual-family STUN/TURN, mapped IPv6, genuine DTLS option and device edits survive category/tab changes; Save keeps both masters OFF');
 phase='early block and scoped protocols';
 await opened.click('[data-antidetect-master]');await ready();const customActive=await state();assert.equal(customActive.configuration.antidetectEnabled,true);assert.equal(customActive.configuration.enabled,false,'Antidetect ON never enables API Guard');assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-save]').disabled),true,'master commits without a second Save');
 // The blocked modes belong to API Guard. Enable its own master explicitly in this owned fixture.
 const apiEnabled=await send({type:'ui-api-config-set',tabId:null,expectedRevision:customActive.revision,configuration:{...customActive.configuration,enabled:true}});assert.equal(apiEnabled.type,'api-config-state',apiEnabled.code);assert.equal(apiEnabled.configuration.antidetectEnabled,true);assert.equal(apiEnabled.configuration.enabled,true);
 await opened.click('[data-antidetect-refresh]');await ready();
 await opened.click('[data-antidetect-mode="webrtc:block"]');await opened.click('[data-antidetect-mode="websocket:block"]');
 const blocked=await save();assert.equal(blocked.registration,'ready');assert.equal(blocked.configuration.enabled,true);assert.equal(blocked.configuration.antidetectEnabled,true);
 await until(()=>evaluate(()=>document.querySelector('[data-module-indicator="api"]')?.getAttribute('data-module-state')==='active'&&document.querySelector('[data-module-indicator="antidetect"]')?.getAttribute('data-module-state')==='active'),'saved active guard and Antidetect indicators');
 const first=await probe();assert.equal(first.rtc,'undefined');assert.equal(first.ws,'undefined');assert.equal(first.childRtc,'undefined');assert.equal(first.childWs,'undefined');assert.equal(first.afterStopRtc,'undefined');assert.equal(first.afterStopWs,'undefined');
 assert.deepEqual(blocked.configuration.apis.find(row=>row.id==='webrtc').selected,rtc.selected);
 const ruleScope=await evaluate(()=>document.querySelector('[data-antidetect-protocol-scope="websocket"]').textContent);evidence.nativeScope=ruleScope;
 check('Antidetect ON preserves API Guard OFF; explicitly enabling API Guard permits early WebRTC/WebSocket blocking while preserving dormant Spoof values');
 phase='allow does not use custom';
 await opened.click('[data-antidetect-mode="webrtc:allow"]');await opened.click('[data-antidetect-mode="websocket:allow"]');const allowed=await save();
 const restored=await probe();assert.equal(restored.rtc,'function');assert.equal(restored.ws,'function');assert.deepEqual(allowed.configuration.apis.find(row=>row.id==='webrtc').selected,rtc.selected);
 await opened.goto(opened.base+'options.html#antidetect');await ready();assert.equal((await state()).revision,allowed.revision);
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-mode="webrtc:allow"]').getAttribute('aria-checked')),'true');
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-spoof-fields]').disabled),true);
 check('Allow restores native APIs on fresh documents, leaves saved custom data dormant and survives reopening');
 phase='conflict and stale editor';
 await opened.click('[data-antidetect-mode="webrtc:spoof"]');await opened.fill('[data-antidetect-address="ipv4:host"]','999.1.1.1');await opened.click('[data-antidetect-save]');await ready();
 assert.ok(await evaluate(()=>document.querySelector('[data-antidetect-error]')?.textContent));assert.equal((await state()).revision,allowed.revision);await opened.click('[data-antidetect-cancel]');
 await opened.click('[data-antidetect-mode="webrtc:block"]');await send({type:'ui-api-config-set',tabId:null,expectedRevision:allowed.revision,configuration:{...allowed.configuration,preset:'limited'}});
 await until(()=>evaluate(()=>Boolean(document.querySelector('[data-antidetect-external-change]'))),'stale editor indication');
 assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-save]').disabled),true);await opened.click('[data-antidetect-cancel]');await opened.click('[data-antidetect-refresh]');await ready();
 check('invalid addresses cannot write; external revisions preserve the draft and prevent stale overwrite');
 phase='native privacy permission and release';
 const policyBefore=await state();
 await select('[data-antidetect-network-policy]','disable_non_proxied_udp');
 await opened.click('[data-antidetect-save]');await ready();
 assert.ok(await evaluate(()=>document.querySelector('[data-antidetect-error]')?.textContent));assert.equal((await state()).revision,policyBefore.revision);
 if(browser==='firefox'){
  await opened.click('[data-antidetect-grant-privacy]');await ready();
  assert.equal(await evaluate(()=>document.querySelector('[data-antidetect-network-policy]').value),'disable_non_proxied_udp');
  const policySaved=await save();assert.equal(policySaved.webrtcNetwork.status,'applied');assert.equal(policySaved.webrtcNetwork.value,'disable_non_proxied_udp');
  await select('[data-antidetect-network-policy]','system');const released=await save();assert.equal(released.webrtcNetwork.desired,'system');assert.equal(released.webrtcNetwork.status,'inactive');
  check('native Firefox optional privacy grant preserves the draft, applies the real browser policy and System releases its owned layer');
 }else{await opened.click('[data-antidetect-cancel]');check('missing optional privacy access rejects Save before persistence; the draft remains cancellable');}
 phase='locale and layout';
 const locales=browser==='chrome'?PRODUCTION_LANGUAGES.map(item=>typeof item==='string'?item:item.id):['ru','en','ar'];
 for(const locale of locales){await evaluate(locale=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':locale}),locale);await until(()=>evaluate(locale=>document.querySelector('[data-management-shell]').lang===locale.replaceAll('_','-'),locale),'locale '+locale);for(const category of ['quick','device','os','browser','network']){await opened.click('[data-antidetect-category="'+category+'"]');const text=await evaluate(()=>document.querySelector('[data-antidetect-app]').textContent);assert.ok(!/antidetect_(?:editor|category|status|description)|protection_feature_/.test(text),locale+' localized '+category);} }
 await evaluate(()=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':'ar'}));await until(()=>evaluate(()=>document.querySelector('[data-management-shell]').lang==='ar'),'Arabic layout');
 await opened.click('[data-antidetect-category="network"]');
 for(const width of [1180,520,340]){await opened.viewport(width,900);await opened.media({colorScheme:'dark',reducedMotion:'reduce'});const row=await evaluate(()=>{const nav=document.querySelector('[data-antidetect-navigation]'),main=document.querySelector('[data-antidetect-main]'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,dir:getComputedStyle(document.querySelector('[data-antidetect-app]')).direction,navDisplay:getComputedStyle(nav).display,nav:rect(nav),main:rect(main),bounds:[...document.querySelectorAll('.management-header,.management-brand,.management-brand h1,[data-antidetect-app],.antidetect-card,[data-antidetect-navigation],[data-antidetect-main]')].map(rect)};});assert.equal(row.overflow,false,JSON.stringify(row));assert.equal(row.dir,'rtl');assert.equal(row.navDisplay,'flex');assert.ok(row.main.top>=row.nav.bottom,'RTL category layout '+JSON.stringify(row));for(const bound of row.bounds){assert.ok(bound.left>=-1&&bound.right<=row.width+1,'RTL clipping '+JSON.stringify(bound));}evidence.layouts.push(row);}
 phase='level layouts';
 for(const width of [1180,520,340]){await opened.viewport(width,900);for(const category of ['quick','device','os','browser']){await opened.click('[data-antidetect-category="'+category+'"]');await until(()=>evaluate(category=>Boolean(document.querySelector('[data-antidetect-app]'))&&document.querySelector('[data-antidetect-category="'+category+'"]').getAttribute('aria-selected')==='true',category),'level '+category);const row=await evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,bounds:[...document.querySelectorAll('.antidetect-level,.fp-slider,.fp-combobox,.fp-device-card,.fp-presets,.antidetect-randomize')].filter(e=>e.getClientRects().length).map(rect)};});assert.equal(row.overflow,false,'level '+category+' overflows at '+width+' '+JSON.stringify(row));for(const bound of row.bounds){assert.ok(bound.left>=-1&&bound.right<=row.width+1,'level '+category+' clips at '+width+' '+JSON.stringify(bound));}}}
 check('quick setup and the three levels keep sliders, combobox and device card inside the viewport at 340-1180px in RTL');
 await opened.click('[data-antidetect-category="network"]');
 if(browser==='chrome'){await opened.media({forcedColors:'active'});const contrast=await evaluate(()=>[...document.querySelectorAll('[data-antidetect-mode][aria-checked="true"]')].filter(e=>e.getClientRects().length).map(e=>({foreground:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})));assert.ok(contrast.length);for(const colors of contrast)assert.notEqual(colors.foreground,colors.background);evidence.forcedColors=contrast;await opened.media({forcedColors:'none',colorScheme:'dark'});}
 await opened.screenshot(join(run,'antidetect-narrow.png'));await opened.viewport(1180,900);await opened.media({colorScheme:'light'});await evaluate(()=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':'ru'}));await until(()=>evaluate(()=>document.querySelector('[data-management-shell]').lang==='ru'),'Russian screenshot');await opened.click('[data-antidetect-mode="webrtc:spoof"]');await opened.screenshot(join(run,'antidetect-ru-wide.png'));await opened.click('[data-antidetect-cancel]');check('localized categories and reused editors render without raw keys; dark RTL narrow layout has no horizontal overflow');
 evidence.result='PASS';console.log('Antidetect UI '+browser+': '+evidence.checks.length+' checks PASS');
}catch(error){evidence.result='FAIL';evidence.phase=phase;evidence.error=error.stack;throw error;}
finally{writeFileSync(join(run,'result.json'),JSON.stringify(evidence,null,2)); const artifacts=join(root,'test-results/production-1.1.0/antidetect');mkdirSync(artifacts,{recursive:true});writeFileSync(join(artifacts,'ui-'+browser+'.json'),JSON.stringify(evidence,null,2));await opened?.close();await new Promise(done=>server.close(done));}
