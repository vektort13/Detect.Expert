// ADR-076: native exact-document host lookup; never match a redacted registrable host.
import { readPrecursorZoneRequest, readPrecursorZoneSnapshot } from './precursor-modes-contracts.js';
const pending = new WeakMap();
export async function readPrecursorZone(runtime, value) {
  const request=readPrecursorZoneRequest(value);if(!request)return null;
  const empty=()=>({schemaVersion:1,type:'precursor-zone-state',documentKey:request.documentKey,state:null});
  const slot=`${request.tabId}:${request.frameId}`, binding=runtime.state.bindings.get(slot), generation=runtime.scope.accessGeneration;
  const live=()=>runtime.scope.hasDataConsent===true&&runtime.scope.accessReady===true&&runtime.scope.accessGeneration===generation&&
    runtime.state.bindings.get(slot)?.documentKey===request.documentKey&&runtime.state.bindings.get(slot)?.boundAt===binding?.boundAt&&
    runtime.getProjection(request.tabId,request.frameId)?.documentKey===request.documentKey&&
    !['paused','no-access','unsupported'].includes(runtime.getProjection(request.tabId,request.frameId)?.coverageState);
  if(!binding||binding.documentKey!==request.documentKey||!live()||!runtime.precursorModes)return empty();
  // No native call at all when no zone has ever been configured.
  if(!runtime.precursorModes.getState().zone)return empty();
  let jobs=pending.get(runtime);if(!jobs){jobs=new Map();pending.set(runtime,jobs);}
  if(jobs.has(slot)||jobs.size>=4)return empty();
  const documentId=request.documentKey.slice(slot.length+1),job=Promise.resolve().then(()=>live()?
    typeof runtime.api.__detectExpertResolveDocument==='function'?runtime.api.__detectExpertResolveDocument({tabId:request.tabId,frameId:request.frameId,documentId}):
      runtime.api.webNavigation.getFrame({tabId:request.tabId,frameId:request.frameId}):null);
  jobs.set(slot,job);job.then(()=>jobs.delete(slot),()=>jobs.delete(slot));
  let timer;
  try {
    const frame=await Promise.race([job,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);
    if(!live()||!frame||frame.documentId!==documentId||frame.errorOccurred===true||frame.documentLifecycle!=='active')return empty();
    const url=new URL(frame.url);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!runtime.scope.isHostGrantedSync(url.hostname,url.protocol.slice(0,-1)))return empty();
    const config=runtime.precursorModes.snapshotForHost(url.hostname.toLowerCase()),change=config?.history.at(-1);
    // Only the rendered facts leave the settings service. No account zone ID or full history.
    const state=config?{status:config.status,zoneName:config.zone.name,mode:config.mode,checkedAt:config.checkedAt,
      lastChange:change?{from:change.from,to:change.to,at:change.at}:null}:null;
    return readPrecursorZoneSnapshot({...empty(),state})??empty();
  }catch{return empty();}finally{clearTimeout(timer);}
}
