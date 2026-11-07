// Owned local native bindings proof; no extension delivery or GPU metadata strings are claimed here.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

export async function webGlProtectionNativeProbe(install){
  const checks=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
  const rows=[['HTMLCanvasElement',()=>document.createElement('canvas'),['webgl','webgl2','experimental-webgl']],['OffscreenCanvas',()=>new OffscreenCanvas(2,2),['webgl','webgl2']]].filter(([name])=>typeof globalThis[name]==='function');
  const originals=[],calls=new Map();let errors=0;const eventError=()=>{errors++;};addEventListener('error',eventError);
  function failure(method,receiver,args){try{Reflect.apply(method,receiver,args);return null;}catch(error){return{name:error.name,message:error.message};}}
  for(const[name]of rows){const target=globalThis[name].prototype,field=Object.getOwnPropertyDescriptor(target,'getContext'),original=field.value;originals.push({name,target,field,original});calls.set(name,0);Object.defineProperty(target,'getContext',{...field,value:{getContext(){calls.set(name,calls.get(name)+1);return Reflect.apply(original,this,arguments);}}.getContext});}
  const guard=install(globalThis,'webgl');
  try{
    for(const[name,make,names]of rows){
      const native=originals.find(row=>row.name===name).original,guarded=globalThis[name].prototype.getContext;
      for(const type of names)for(const shape of ['primitive','String','toString','toPrimitive','fallback','callable']){
        const canvas=make();let reads=0,options=0,value;
        if(shape==='primitive')value=type;else if(shape==='String')value=new String(type);else if(shape==='toString')value={toString(){check('coercion receiver '+name+'/'+type,this===value);reads++;return type;}};
        else if(shape==='toPrimitive')value={[Symbol.toPrimitive](hint){check('native string hint '+name+'/'+type,hint==='string'&&this===value);reads++;return type;}};
        else if(shape==='fallback')value={toString(){reads++;return{};},valueOf(){reads++;return type;}};
        else value=Object.assign(function(){},{[Symbol.toPrimitive](){reads++;return type;}});
        const before=calls.get(name),result=canvas.getContext(value,{get alpha(){options++;throw Error('blocked options read');}});
        check(name+'/'+type+'/'+shape+' blocks native-once before allocation',result===null&&calls.get(name)===before+1&&options===0&&reads===(shape==='fallback'?2:shape==='primitive'||shape==='String'?0:1));
        check(name+'/'+type+'/'+shape+' preserves same-canvas 2d fallback',Boolean(canvas.getContext('2d')));
      }
      for(const type of ['2d','bitmaprenderer']){
        const canvas=make();let reads=0;const value={toString(){reads++;return type;}};const before=calls.get(name),result=canvas.getContext(value);
        check(name+'/'+type+' remains native with one caller coercion',result===Reflect.apply(native,canvas,[type])&&reads===1&&calls.get(name)===before+1);
      }
      let keyReads=0;const key={toString(){keyReads++;return'webgl';}};
      check(name+' invalid receiver preserves native error before coercion',JSON.stringify(failure(guarded,{},[key]))===JSON.stringify(failure(native,{},[key]))&&keyReads===0);
      check(name+' missing argument preserves native error',JSON.stringify(failure(guarded,make(),[]))===JSON.stringify(failure(native,make(),[])));
      check(name+' Symbol preserves native DOMString error',JSON.stringify(failure(guarded,make(),[Symbol('webgl')]))===JSON.stringify(failure(native,make(),[Symbol('webgl')])));
      const sentinel={own:true};let observed;try{make().getContext({toString(){throw sentinel;}});}catch(error){observed=error;}check(name+' caller exception identity preserved',observed===sentinel);
      check(name+' method remains nonconstructible',!Object.hasOwn(guarded,'prototype')&&failure(Reflect.construct,Reflect,[String,[],guarded])?.name==='TypeError');
    }
    if(typeof OffscreenCanvas==='function')check('Offscreen unsupported experimental alias keeps native enum error',JSON.stringify(failure(OffscreenCanvas.prototype.getContext,new OffscreenCanvas(2,2),[new String('experimental-webgl')]))===JSON.stringify(failure(originals.find(row=>row.name==='OffscreenCanvas').original,new OffscreenCanvas(2,2),[new String('experimental-webgl')])));
    await new Promise(done=>setTimeout(done,0));check('private conversion abort raises no global error event',errors===0);
    const state=guard.snapshot();check('native hook installation has no unavailable surface',state.unavailable===0);return{checks,state};
  }finally{guard.stop();for(const row of originals)Object.defineProperty(row.target,'getContext',row.field);removeEventListener('error',eventError);}
}

async function main(){
 const root=resolve(import.meta.dirname,'../..'),firefox=process.argv.includes('--firefox'),installed=process.argv.includes('--installed-chrome');mkdirSync(join(root,'.tmp'),{recursive:true});const run=mkdtempSync(join(root,'.tmp/webgl-guard-'));
 const runtime=readFileSync(join(root,'apps/production-extension/protection-runtime.js'),'utf8'),evidence={at:new Date().toISOString(),result:'RUNNING',run,scope:'native WebGL binding semantics only; own loopback page; no GPU strings/devices/external network',runtimeSHA:createHash('sha256').update(runtime).digest('hex')};
 const html='<!doctype html><script type="module">import{installProtection}from"/guard.js";try{window.__result=await ('+webGlProtectionNativeProbe.toString()+')(installProtection)}catch(error){window.__failure={name:error.name,message:error.message}}</script>';
 const server=createServer((q,r)=>{r.setHeader('Content-Type',q.url==='/guard.js'?'application/javascript':'text/html');r.end(q.url==='/guard.js'?runtime:html);});await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 let browser,driver,session,endpoint;
 async function port(){const s=createServer();await new Promise(done=>s.listen(0,'127.0.0.1',done));const value=s.address().port;await new Promise(done=>s.close(done));return value;}
 async function command(path,body,method='POST'){const response=await fetch(endpoint+path,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),signal:AbortSignal.timeout(30000)});const value=(await response.json()).value;if(!response.ok||value?.error)throw Error(JSON.stringify(value));return value;}
 try{
  if(!firefox){browser=await chromium.launch({channel:installed?'chrome':'chromium',headless:true,args:['--enable-unsafe-swiftshader']});evidence.browser=browser.version();const page=await browser.newPage();await page.goto(origin);await page.waitForFunction(()=>Boolean(window.__result||window.__failure));const result=await page.evaluate(()=>window.__failure?{failure:window.__failure}:window.__result);assert.equal(result.failure,undefined,JSON.stringify(result.failure));Object.assign(evidence,result);}
  else{const profile=join(run,'profile');mkdirSync(profile);writeFileSync(join(profile,'user.js'),'user_pref("network.proxy.type",0);\nuser_pref("toolkit.telemetry.enabled",false);\n');const binary=process.env.FIREFOX_BINARY??spawnSync('powershell.exe',['-NoProfile','-Command',"(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"],{encoding:'utf8',windowsHide:true}).stdout.trim();const http=await port(),bidi=await port();endpoint='http://127.0.0.1:'+http;driver=spawn(process.env.GECKODRIVER_BINARY??join(root,'.tmp/firefox/tools/geckodriver.exe'),['--host','127.0.0.1','--port',String(http),'--websocket-port',String(bidi),'--log','fatal'],{windowsHide:true,stdio:'ignore'});for(let i=0;i<80;i++){try{await command('/status',undefined,'GET');break;}catch{await new Promise(done=>setTimeout(done,100));}}const opened=await command('/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{binary,args:['-headless','-no-remote','-profile',profile]}}}});session=opened.sessionId;evidence.browser=opened.capabilities.browserVersion;await command('/session/'+session+'/url',{url:origin});let result;for(let i=0;i<100;i++){result=await command('/session/'+session+'/execute/sync',{script:'return window.__failure?{failure:window.__failure}:window.__result;',args:[]});if(result)break;await new Promise(done=>setTimeout(done,60));}assert.ok(result);assert.equal(result.failure,undefined,JSON.stringify(result.failure));Object.assign(evidence,result);}
  evidence.result='PASS';
 }catch(error){evidence.result='FAIL';evidence.failure={name:error.name,message:error.message};process.exitCode=1;console.error(error);}
 finally{await browser?.close();if(session)try{await command('/session/'+session,undefined,'DELETE');}catch{}driver?.kill();server.closeAllConnections();await new Promise(done=>server.close(done));const output=join(root,'test-results/production-1.1.0/webgl-protection-'+(firefox?'firefox138':installed?'chrome155':'chromium153')+'.json');writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({result:evidence.result,browser:evidence.browser,checks:evidence.checks?.length,output}));}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await main();
