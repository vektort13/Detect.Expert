// ADR-101: one explicitly opened native-profile window, controlled only by top-level Options.
import {compileFingerprintEngineProfile} from './fingerprint-engine-profile.js';
import {createFingerprintEngineDriver} from './fingerprint-engine-driver.js';
import {prepareFingerprintWorkerSource} from './fingerprint-engine-worker.js';
import {FINGERPRINT_ENGINE_PORT} from './fingerprint-engine-shared.js';
import {createFingerprintEngineCheckpoint} from './fingerprint-engine-checkpoint.js';

export {FINGERPRINT_ENGINE_PORT};
const MAX_PORTS=8,MAX_RECENT=64,TIMEOUT=6000;
const CODES=new Set(['unsupported','invalid-input','stale-revision','inactive','permission-required','empty-profile','profile-conflict','scope-denied','busy','timeout','native-error','debugger-detached','profile-changed','not-ready']);
const own=(object,key)=>object&&typeof object==='object'?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safe=error=>CODES.has(own(error,'code'))?own(error,'code'):'native-error';
const int=value=>Number.isSafeInteger(value)&&value>=0;
function exact(value,keys){
 if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid-input');
 const fields=Reflect.ownKeys(value);if(fields.length!==keys.length||fields.some(key=>typeof key!=='string'||!keys.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))fail('invalid-input');
}
export function isFingerprintEngineSender(api,sender){
 try{const expected=new URL(api.runtime.getURL('options.html'));const matches=raw=>{const url=new URL(raw);return url.protocol===expected.protocol&&url.host===expected.host&&url.pathname===expected.pathname&&!url.username&&!url.password;};
 return sender?.id===api.runtime.id&&matches(sender.url)&&(sender.frameId===undefined||sender.frameId===0)&&(!sender.origin||sender.origin===expected.protocol+'//'+expected.host)&&(!sender.documentLifecycle||sender.documentLifecycle==='active')&&(sender.tab===undefined||sender.frameId===0&&(!sender.tab.url||matches(sender.tab.url)));
 }catch{return false;}
}
export function validateFingerprintEngineCommand(value){
 exact(value,Object.hasOwn(value??{},'payload')?['v','id','op','payload']:['v','id','op']);
 if(value.v!==1||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.id)||!['load','start','stop'].includes(value.op))fail('invalid-input');
 if(value.op!=='start'){if(Object.hasOwn(value,'payload'))fail('invalid-input');return{v:1,id:value.id,op:value.op};}
 exact(value.payload,['url','expectedRevision']);if(!int(value.payload.expectedRevision))fail('invalid-input');
 const raw=value.payload.url;if(typeof raw!=='string'||raw.length<1||raw.length>4096||raw.trim()!==raw||/[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/u.test(raw))fail('invalid-input');
 let url;try{url=new URL(raw);}catch{fail('invalid-input');}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)fail('invalid-input');
 return{v:1,id:value.id,op:'start',payload:{url:url.href,expectedRevision:value.payload.expectedRevision}};
}
function granted(pattern,url){
 if(pattern==='<all_urls>')return true;
 if(typeof pattern!=='string')return false;const match=/^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);if(!match||match[1]!=='*'&&match[1]+':'!==url.protocol)return false;
 const host=match[2];return host==='*'||host===url.hostname||host.startsWith('*.')&&(url.hostname===host.slice(2)||url.hostname.endsWith('.'+host.slice(2)));
}
function signature(configuration){
 return JSON.stringify({antidetectEnabled:configuration.antidetectEnabled,enabled:configuration.enabled,apis:configuration.apis.map(row=>({id:row.id,mode:row.mode,selected:row.selected})),sites:configuration.sites.map(site=>({host:site.host,disabled:site.disabled,apis:site.apis.map(row=>({id:row.id,mode:row.mode,selected:row.selected}))}))});
}
// ADR-107: the claimed window (screen-geometry outer size, else the claimed available screen) in CSS pixels, or null.
export function claimedSessionWindow(configuration){
 const value=id=>{const row=Array.isArray(configuration?.apis)?configuration.apis.find(item=>item?.id===id):undefined;return row?.mode==='custom'&&row.selected?.kind==='value'?row.selected.value:undefined;};
 const geometry=value('screen-geometry'),width=geometry?.outerWidth??value('screen-avail-width'),height=geometry?.outerHeight??value('screen-avail-height');
 return int(width)&&width>0&&int(height)&&height>0?{width,height}:null;
}
// The work area of this machine as far as the windows API shows it without a permission: the size of a maximized window (the
// last focused one first: Options, where Start is clicked; else the largest maximized one). null when none is maximized.
const maximized=window=>own(window,'state')==='maximized'&&int(own(window,'width'))&&own(window,'width')>0&&int(own(window,'height'))&&own(window,'height')>0?{width:own(window,'width'),height:own(window,'height')}:null;

export function installFingerprintEngineService(api=globalThis.chrome,{getProfile,isActive=()=>true,prepareWorker=async(configuration,options)=>prepareFingerprintWorkerSource(configuration,options),driver:suppliedDriver=null,createDriver=createFingerprintEngineDriver,checkpoint=createFingerprintEngineCheckpoint(api)}={}){
 const ports=new Map(),closedWindows=new WeakSet(),closingWindows=new WeakMap(),permissionReads=new Map();let disposed=false,epoch=0,record=null,orphan=null,operation=null,physical=null,preparing=null,profileRead=null,revalidating=null,status='ready',lastError=null,sequence=0;
 let hydrated=false,hydrating=null;
 async function hydrate(){if(hydrated)return;if(hydrating)return hydrating;hydrating=(async()=>{try{const window=await checkpoint.restore();if(window){orphan=window;status='detached';lastError='debugger-detached';}hydrated=true;}catch{status='error';lastError='not-ready';fail('not-ready');}finally{hydrating=null;}})();return hydrating;}
 const supported=()=>!!api?.debugger?.attach&&!!api?.debugger?.sendCommand&&!!api?.windows?.create&&!!api?.tabs?.update&&typeof getProfile==='function';
 const driver=suppliedDriver??createDriver(api,{onChange:()=>publish(),onDetach:()=>{if(record){record.valid=false;++epoch;status='detached';lastError='debugger-detached';publish();}},allowTarget:async target=>{
  const current=record,version=epoch;if(disposed||isActive()!==true||!current||target.tabId!==current.tabId||target.type!=='worker'||!current.valid)return false;
  let url;try{url=new URL(target.url);}catch{return false;}
  if(url.protocol==='blob:'){try{url=new URL(url.origin);}catch{return false;}}
  if(!['http:','https:'].includes(url.protocol)||url.origin!==current.origin)return false;
  try{const fresh=await read();if(disposed||isActive()!==true||record!==current||!current.valid||epoch!==version||fresh.active!==true||signature(fresh.configuration)!==current.signature)return false;
   const granted=await permissions(url,fresh.matches);return granted&&isActive()===true&&record===current&&current.valid&&epoch===version;
  }catch{return false;}
 }});
 function snapshot(){
  const native=driver.snapshot();
  return{supported:supported(),status:!supported()?'unsupported':status,sequence,error:lastError,sessionOpen:!!record||!!orphan,revision:record?.revision??null,native:{status:native.status,attached:native.attached===true,workerCount:int(native.workerCount)?native.workerCount:0,bootstrappedWorkers:int(native.bootstrappedWorkers)?native.bootstrappedWorkers:0,unsupported:Array.isArray(native.unsupported)?native.unsupported.filter(item=>['shared-worker','service-worker','worklet'].includes(item)):[]},partial:record?.plan.status==='partial'||native.status==='partial',unsupportedFields:record?.plan.unsupported.map(row=>({id:row.id,fields:[...row.fields],reason:row.reason}))??[]};
 }
 function publish(){sequence=sequence<Number.MAX_SAFE_INTEGER?sequence+1:0;const value=snapshot();for(const[port,state]of ports)if(!state.closed)try{port.postMessage({v:1,type:'state',value});}catch{}return value;}
 async function deadline(job){let timer;try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{code:'timeout'})),TIMEOUT);})]);}finally{clearTimeout(timer);}}
 // ADR-107: the session window takes the claimed window size, never larger than the work area (see maximized); without a claim or a
 // known work area Chrome picks the size, as before. A failing or slow windows read only skips the sizing.
 async function sessionBounds(configuration){
  const claim=claimedSessionWindow(configuration);if(!claim)return{};
  let area=null;
  try{
   if(typeof api.windows?.getLastFocused==='function')area=maximized(await deadline(Promise.resolve().then(()=>api.windows.getLastFocused({populate:false}))));
   if(!area&&typeof api.windows?.getAll==='function'){const all=await deadline(Promise.resolve().then(()=>api.windows.getAll({populate:false})));for(const window of Array.isArray(all)?all.slice(0,64):[]){const size=maximized(window);if(size&&(!area||size.width*size.height>area.width*area.height))area=size;}}
  }catch{return{};}
  return area?{width:Math.min(claim.width,area.width),height:Math.min(claim.height,area.height)}:{};
 }
 async function permissions(url,matches){
  if(!Array.isArray(matches)||!matches.some(pattern=>granted(pattern,url)))return false;
  const pattern=url.protocol+'//'+url.hostname+'/*';let row=permissionReads.get(pattern);
  if(!row){if(permissionReads.size>=4)return false;const work=Promise.resolve().then(()=>api.permissions.contains({origins:[pattern]}));row={work,logical:deadline(work)};permissionReads.set(pattern,row);work.then(()=>{if(permissionReads.get(pattern)===row)permissionReads.delete(pattern);},()=>{if(permissionReads.get(pattern)===row)permissionReads.delete(pattern);});}
  try{return await row.logical===true;}catch{return false;}
 }
 async function closeWindow(window){
  if(!window||typeof window!=='object'||!int(window.id)||closedWindows.has(window))return true;
  if(closingWindows.has(window))return closingWindows.get(window);
  const work=Promise.resolve().then(()=>api.windows.remove(window.id)).then(()=>{closedWindows.add(window);return true;},()=>closedWindows.has(window)),job=deadline(work).catch(()=>closedWindows.has(window));
  closingWindows.set(window,job);work.then(()=>{if(closingWindows.get(window)===job)closingWindows.delete(window);});return job;
 }
 async function read(){if(disposed)fail('inactive');if(!supported())fail('unsupported');if(!profileRead){const work=Promise.resolve().then(getProfile),row={work,logical:deadline(work)};profileRead=row;work.then(()=>{if(profileRead===row)profileRead=null;},()=>{if(profileRead===row)profileRead=null;});}const state=await profileRead.logical;if(!state||!int(state.revision)||!state.configuration||!Array.isArray(state.matches))fail('not-ready');return state;}
 async function start(payload){
  await hydrate();
  if(disposed)fail('inactive');if(!supported())fail('unsupported');if(operation||physical||preparing||record||orphan||status==='stopping')fail('busy');
  const token={epoch:++epoch};operation=token;status='starting';lastError=null;publish();let created=null;
  const current=()=>!disposed&&isActive()===true&&epoch===token.epoch&&(operation===token||record?.token===token&&record.valid);
  try{
   const source=await read();if(!current())fail('inactive');if(source.revision!==payload.expectedRevision)fail('stale-revision');if(source.active!==true||!source.configuration.antidetectEnabled)fail('inactive');
   const url=new URL(payload.url);if(!await permissions(url,source.matches))fail('scope-denied');if(!current())fail('inactive');
   const plan=compileFingerprintEngineProfile(source.configuration,{host:url.hostname});if(!plan.ok)fail('profile-conflict');if(plan.status==='empty')fail('empty-profile');
   const preparation=Promise.resolve().then(()=>prepareWorker(source.configuration,{host:url.hostname}));preparing=preparation;preparation.then(()=>{if(preparing===preparation)preparing=null;},()=>{if(preparing===preparation)preparing=null;});
   const workerSource=await deadline(preparation);if(!current())fail('inactive');
   const bounds=await sessionBounds(source.configuration);if(!current())fail('inactive');
   const creation=Promise.resolve().then(()=>{if(!current())fail('inactive');return api.windows.create({url:'about:blank',type:'normal',focused:true,...bounds});});physical=creation;
   creation.then(window=>{if(!current()){
    orphan=window;status='stopping';publish();
    void closeWindow(window).then(async closed=>{
     if(closed||closedWindows.has(window)){if(orphan===window)orphan=null;if(!record&&!orphan)status='ready';publish();return;}
     if(orphan!==window)return;status='error';lastError='native-error';const tab=window?.tabs?.find(item=>int(item.id));if(int(window?.id)&&tab)try{await checkpoint.save(window.id,tab.id);}catch{lastError='not-ready';}publish();
    });
   }},()=>{}).finally(()=>{if(physical===creation){physical=null;publish();}});
   created=await deadline(creation);if(!current())fail('inactive');const tab=created?.tabs?.find(item=>int(item.id));if(!int(created?.id)||!tab)fail('native-error');
   record={windowId:created.id,window:created,tabId:tab.id,origin:url.origin,matches:[...source.matches],revision:source.revision,signature:signature(source.configuration),plan,valid:true,token};
   await checkpoint.save(created.id,tab.id);if(!current())fail('inactive');
   const latest=await read();if(!current()||latest.revision!==source.revision||latest.active!==true)fail('stale-revision');if(!await permissions(url,latest.matches))fail('scope-denied');
   const attached=await driver.start({tabId:tab.id,profile:plan,workerSource,isCurrent:()=>current()&&record?.valid===true});if(!current())fail('inactive');
   if(attached?.attached!==true||!['ready','partial'].includes(attached.status))fail('native-error');
   // Initial navigation happens only after native metrics and first-worker pause are ready.
   await deadline(api.tabs.update(tab.id,{url:payload.url,active:true}));if(!current())fail('inactive');
   status=plan.status==='partial'?'partial':'running';operation=null;return publish();
  }catch(error){
   if(record?.token===token){record.valid=false;try{await driver.stop();}catch{}}
   const closed=created?await closeWindow(created):true;if(record?.windowId===created?.id&&closed){record=null;try{await checkpoint.clear();}catch{}}if(created&&!closed)orphan=created;
   if(operation===token){operation=null;status='error';lastError=safe(error);publish();}throw Object.assign(new Error(safe(error)),{code:safe(error)});
  }
 }
 async function stop({close=true,code=null}={}){
  await hydrate();
  ++epoch;operation=null;if(record)record.valid=false;status='stopping';if(code)lastError=code;publish();const previous=record;
  let failed=false;try{await driver.stop();failed=driver.snapshot().attached===true;}catch{failed=true;}
  if(failed)lastError='native-error';
  const target=previous?.window??orphan;
  if(close&&target){if(await closeWindow(target)){if(record===previous)record=null;if(orphan===target)orphan=null;try{await checkpoint.clear();}catch{failed=true;lastError='not-ready';}}else{lastError='native-error';status='error';return publish();}}
  status=failed?'error':record||orphan?'stopped':'ready';if(!code&&!failed)lastError=null;return publish();
 }
 const onConnect=port=>{
  if(port?.name!==FINGERPRINT_ENGINE_PORT)return;
  if(disposed||ports.size>=MAX_PORTS||!isFingerprintEngineSender(api,port.sender)){try{port.disconnect();}catch{}return;}
  const state={closed:false,seen:new Set(),ids:[],pending:0};ports.set(port,state);
  const receive=async message=>{
   if(state.closed||disposed||state.pending>=4)return;let command,counted=false;
   try{if(!isFingerprintEngineSender(api,port.sender))fail('inactive');command=validateFingerprintEngineCommand(message);if(state.seen.has(command.id))fail('invalid-input');state.seen.add(command.id);state.ids.push(command.id);if(state.ids.length>MAX_RECENT)state.seen.delete(state.ids.shift());state.pending++;counted=true;
    const value=command.op==='load'?(await hydrate(),snapshot()):command.op==='start'?await start(command.payload):await stop();if(!state.closed)port.postMessage({v:1,id:command.id,ok:true,value});
   }catch(error){if(!state.closed&&typeof own(message,'id')==='string')try{port.postMessage({v:1,id:message.id,ok:false,error:safe(error)});}catch{}}
   finally{if(counted)state.pending--;}
  };
  const disconnect=()=>{state.closed=true;ports.delete(port);port.onMessage?.removeListener?.(receive);};port.onMessage.addListener(receive);port.onDisconnect.addListener(disconnect);
 };
 const removed=tabId=>{if(record?.tabId!==tabId)return;const previous=record;record=null;++epoch;operation=null;status='ready';void checkpoint.clear().catch(()=>{});void driver.stop().catch(()=>{}).finally(()=>{if(record!==previous)publish();});};
 const navigation=details=>{if(!record||details.tabId!==record.tabId||details.frameId!==0)return;let origin;try{origin=new URL(details.url).origin;}catch{return;}if(origin!==record.origin&&details.url!=='about:blank')void stop({close:false,code:'scope-denied'});};
 const revalidate=()=>{if(!record||!record.valid||revalidating)return;const previous=record;revalidating=read().then(async state=>{if(record!==previous||!previous.valid)return;if(state.active!==true||isActive()!==true){await stop({close:false,code:'inactive'});return;}if(signature(state.configuration)!==previous.signature){await stop({close:false,code:'profile-changed'});return;}if(!await permissions(new URL(previous.origin),state.matches))await stop({close:false,code:'scope-denied'});}).catch(()=>{if(record===previous)void stop({close:false,code:'not-ready'});}).finally(()=>{revalidating=null;});};
 const changed=(changes,area)=>{if(area!=='local'||!record)return;if(!Object.hasOwn(changes,'api-configuration:v1')){revalidate();return;}const configuration=own(own(changes['api-configuration:v1'],'newValue'),'configuration');try{if(configuration&&signature(configuration)===record.signature)return;}catch{}void stop({close:false,code:'profile-changed'});};
 const windowRemoved=windowId=>{if(record?.windowId===windowId){closedWindows.add(record.window);removed(record.tabId);}if(orphan?.id===windowId){closedWindows.add(orphan);orphan=null;void checkpoint.clear().catch(()=>{});publish();}};
 const revoked=()=>{if(record)void stop({close:false,code:'permission-required'});};
 api.runtime.onConnect.addListener(onConnect);api.tabs.onRemoved.addListener(removed);api.windows?.onRemoved?.addListener(windowRemoved);api.webNavigation?.onBeforeNavigate?.addListener(navigation);api.storage?.onChanged?.addListener(changed);api.permissions?.onRemoved?.addListener(revoked);
 return{snapshot,start:payload=>start(validateFingerprintEngineCommand({v:1,id:'internal',op:'start',payload}).payload),stop,async dispose(){disposed=true;try{await stop({close:false});}catch{}api.runtime.onConnect.removeListener(onConnect);api.tabs.onRemoved.removeListener(removed);api.windows?.onRemoved?.removeListener(windowRemoved);api.webNavigation?.onBeforeNavigate?.removeListener(navigation);api.storage?.onChanged?.removeListener(changed);api.permissions?.onRemoved?.removeListener(revoked);for(const[port,state]of ports){state.closed=true;try{port.disconnect();}catch{}}ports.clear();await driver.dispose();}};
}
