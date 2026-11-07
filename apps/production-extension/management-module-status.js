// ADR-090: read-only module indicators. No cookie access, feature writes or grants.
import {readObservationControl} from './observation-control.js';
import {createAutosurfClient} from './autosurf-client.js';
import {createProxyClient} from './proxy-client.js';
export const STATUS_MODULES=Object.freeze(['antidetect','autosurf','proxy','api','detector','firewall']);
export function moduleStatus(section,value) {
  if(section==='detector')return typeof value?.enabled==='boolean'?value.enabled?'active':'off':'unknown';
  if(section==='api'||section==='antidetect'){
    const key=section==='api'?'enabled':'antidetectEnabled';
    if(value?.type!=='api-config-state'||typeof value.configuration?.[key]!=='boolean')return'unknown';
    if(!value.configuration[key])return'off';
    return value.registration==='ready'?'active':value.registration==='error'?'error':value.registration==='inactive'?'inactive':'unknown';
  }
  if(section==='firewall')return value?.type==='protect-state'&&typeof value.state?.state==='string'?(value.state.state==='active'?'active':value.state.state==='paused'?'paused':'off'):'unknown';
  if(section==='autosurf')return value?.status==='running'?'active':value?.status==='paused'?'paused':['idle','completed','stopped','error'].includes(value?.status)?'off':'unknown';
  if(section==='proxy')return value?.status?.state==='connected'&&value.configuration?.enabled===true?'active':value?.status?.state==='connecting'?'connecting':['off','blocked','error','conflict','permission-required'].includes(value?.status?.state)?'off':'unknown';
  return'unknown';
}
const FAMILIES=Object.freeze({guard:['api','antidetect'],detector:['detector'],firewall:['firewall'],autosurf:['autosurf'],proxy:['proxy']});
export function createModuleStatusController(api,{onChange=()=>{},env=globalThis,autosurfFactory=createAutosurfClient,proxyFactory=createProxyClient}={}){
 let active=false,disposed=false,epoch=0,autosurf=null,proxy=null;
 const families=Object.fromEntries(Object.keys(FAMILIES).map(id=>[id,{pending:null,queued:false,version:0}]));
 const timers=typeof env?.setTimeout==='function'&&typeof env?.clearTimeout==='function'?env:globalThis;
 let state=Object.freeze(Object.fromEntries(STATUS_MODULES.map(key=>[key,'unknown'])));
 const publish=(section,value)=>{if(!active||disposed||state[section]===value)return;state=Object.freeze({...state,[section]:value});try{onChange(state)}catch{/* A view is not a privileged action. */}};
 const adopt=(section,value)=>publish(section,moduleStatus(section,value));
 const send=type=>api.runtime.sendMessage({schemaVersion:1,type,...(type==='ui-api-config-get'?{tabId:null}:{})});
 const broadcast=(id,token,value)=>{if(active&&!disposed&&epoch===token){families[id].version++;adopt(id,value)}};
 function client(id,token){
  if(id==='autosurf'){
   if(!autosurf){const next=autosurfFactory(api,{env,onChange:value=>broadcast(id,token,value)});if(active&&!disposed&&epoch===token)autosurf=next;else next.dispose();}
   return autosurf;
  }
  if(!proxy){const next=proxyFactory(api,{env,onChange:value=>broadcast(id,token,value)});if(active&&!disposed&&epoch===token)proxy=next;else next.dispose();}
  return proxy;
 }
 function readFamily(id){
  const family=families[id];
  if(!active||disposed)return Promise.resolve(state);
  if(family.pending){family.queued=true;return family.pending.logical;}
  let finish;
  const job={epoch,version:family.version,timer:null,timedOut:false,finished:false,logical:new Promise(resolve=>{finish=resolve})};
  job.finish=()=>{if(!job.finished){job.finished=true;if(job.timer!==null){timers.clearTimeout(job.timer);job.timer=null;}finish(state)}};
  family.pending=job;
  const current=()=>active&&!disposed&&epoch===job.epoch&&family.pending===job;
  const apply=value=>{for(const section of FAMILIES[id]){if(!current()||family.version!==job.version)return;adopt(section,value)}};
  const unavailable=()=>{for(const section of FAMILIES[id]){if(!current()||family.version!==job.version)return;publish(section,'unknown')}};
  job.timer=timers.setTimeout(()=>{job.timedOut=true;unavailable();job.finish()},4000);
  const physical=Promise.resolve().then(()=>{
   if(!current())return undefined;
   if(id==='guard')return send('ui-api-config-get');
   if(id==='detector')return readObservationControl(api);
   if(id==='firewall'){
    let supported=false;try{supported=api.runtime.getManifest().permissions.includes('declarativeNetRequestWithHostAccess')}catch{/* Unsupported browser. */}
    return supported?send('ui-protect-get-state'):undefined;
   }
   const source=client(id,job.epoch);job.version=family.version;
   return current()?source.load():undefined;
  });
  // Logical timeout settles callers, but never releases this physical slot.
  // A hundred refresh events retain one rerun until that same operation ends.
  void physical.then(value=>{if(!job.timedOut)apply(value)},()=>{if(!job.timedOut)unavailable()}).finally(()=>{
   if(family.pending!==job)return;
   family.pending=null;job.finish();
   if(family.queued&&active&&!disposed){family.queued=false;void readFamily(id);}
  });
  return job.logical;
 }
 function refresh(requested=STATUS_MODULES){
  if(!active||disposed||typeof api?.runtime?.sendMessage!=='function')return Promise.resolve(state);
  const sections=new Set(requested.filter(section=>STATUS_MODULES.includes(section)));
  const ids=Object.entries(FAMILIES).filter(([,members])=>members.some(section=>sections.has(section))).map(([id])=>id);
  if(ids.length===1)return readFamily(ids[0]);
  return Promise.all(ids.map(readFamily)).then(()=>state);
 }
 function deactivate(){
  for(const family of Object.values(families)){family.queued=false;if(family.pending){family.pending.timedOut=true;family.pending.finish();}}
  try{autosurf?.dispose()}catch{/* Other families still dispose. */}try{proxy?.dispose()}catch{/* Other families still dispose. */}autosurf=null;proxy=null;
 }
 function invalidate(requested=STATUS_MODULES){
  const sections=new Set(requested);
  for(const[id,members]of Object.entries(FAMILIES))if(members.some(section=>sections.has(section))){families[id].version++;for(const section of members)publish(section,'unknown');}
  return refresh([...sections]);
 }
 const changed=(changes,area)=>{
  if(!active||!['local','session'].includes(area)||!changes)return;
  const sections=new Set();
  for(const key of Object.keys(changes)){
   if(key==='scope'||key.startsWith('data-consent:')){sections.add('detector');sections.add('api');sections.add('antidetect');}
   if(key==='api-configuration:v1'){sections.add('api');sections.add('antidetect');}
   if(key==='protect'||key.startsWith('protect-'))sections.add('firewall');
   if(key.startsWith('autosurf:'))sections.add('autosurf');
   if(key.startsWith('proxy:'))sections.add('proxy');
  }
  if(sections.size)void invalidate([...sections]);
 };
 const access=()=>{if(active)void invalidate()};
 const subscriptions=[[api?.storage?.onChanged,changed],[api?.permissions?.onAdded,access],[api?.permissions?.onRemoved,access]];
 for(const[event,listener]of subscriptions)event?.addListener?.(listener);
 return{
  getState:()=>state,refresh,
  setActive(value){const next=value===true;if(active===next||disposed)return;active=next;epoch++;if(active){for(const[id,family]of Object.entries(families))if(family.pending)for(const section of FAMILIES[id])publish(section,'unknown');void refresh();}else deactivate();},
  dispose(){if(disposed)return;disposed=true;active=false;epoch++;deactivate();for(const[event,listener]of subscriptions)event?.removeListener?.(listener)},
 };
}
