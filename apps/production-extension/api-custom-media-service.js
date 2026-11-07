// ADR-101: transient codec primitives only; no storage, network or report path.
import {createPrivateMediaCapabilitiesBackend} from './api-custom-media-private-runtime.js';
import {mediaProfileChannel} from './api-custom-media-profile.js';
const own=(value,key)=>value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
export function createMediaCapabilitiesRoute({api,controller,entriesForHost,backend=createPrivateMediaCapabilitiesBackend(globalThis)}){
 const rates=new Map();let pending=0;
 function rate(context){const now=Date.now(),key=context.documentKey;let row=rates.get(key);if(!row||now-row.time>=1000){if(!row&&rates.size>=256){for(const[id,item]of rates)if(now-item.time>=1000)rates.delete(id);if(rates.size>=256)return false;}row={time:now,count:0};rates.set(key,row);}return ++row.count<=20;}
 async function current(context){
  if(!await controller.permitted(context))return false;
  try{const frame=typeof api.__detectExpertResolveDocument==='function'?await api.__detectExpertResolveDocument({tabId:context.tabId,frameId:context.frameId,documentId:context.documentId}):await api.webNavigation.getFrame({tabId:context.tabId,frameId:context.frameId});return frame?.documentId===context.documentId&&frame.documentLifecycle!=='prerender'&&await controller.permitted(context);}catch{return false;}
 }
 return(message,sender)=>{
  if(own(message,'type')!=='api-custom-media-request')return null;
  const payload=own(message,'payload'),serialized=own(payload,'serialized');
  if(pending>=64||!exact(message,['schemaVersion','type','payload'])||own(message,'schemaVersion')!==1||!exact(payload,['serialized'])||typeof serialized!=='string'||serialized.length>16384)return Promise.resolve(null);
  const read=controller.readPageSender(sender,api.runtime.id);if(!read?.ok||!rate(read.context))return Promise.resolve(null);
  const context=read.context;pending++;
  return(async()=>{
   await controller.start();if(!await current(context))return null;
   const configuration=controller.configuration,revision=controller.revision;
   const entry=entriesForHost(configuration,context.host).find(row=>row.id==='media-capabilities'&&row.mode==='custom');
   const profile=entry?.selected?.value,channel=mediaProfileChannel(profile);if(!channel)return null;
   const response=await backend.run(serialized,profile,channel);
   if(configuration!==controller.configuration||revision!==controller.revision||!await current(context))return null;
   return typeof response==='string'&&response.length<=16384?response:null;
  })().catch(()=>null).finally(()=>{pending--;});
 };
}
