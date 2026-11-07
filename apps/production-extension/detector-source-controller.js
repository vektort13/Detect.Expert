// ADR-097: explicit reload of a verified source; no permission or scope changes.
import {readObservationControl} from './observation-control.js';
export async function readDetectorMovementAuthorization(api,tabId,{isCurrent=()=>false,expectedDocumentKey}={}){
  if(!Number.isSafeInteger(tabId)||tabId<0||tabId>2147483647||typeof expectedDocumentKey!=='string'||!expectedDocumentKey||!isCurrent())return false;
  try{
    const [state,response]=await Promise.all([readObservationControl(api),api.runtime.sendMessage({schemaVersion:1,type:'ui-get-report',tabId})]);
    if(!isCurrent()||!state.enabled||response?.schemaVersion!==1||response.type!=='report'||response.report?.documentKey!==expectedDocumentKey||!['active','partial','late-start','degraded'].includes(response.report.coverageState))return false;
    const policy={scopeMode:state.scope.scopeMode,hosts:state.scope.hosts,grantedAllSites:state.scope.grantedAllSites};
    if(policy.scopeMode==='active-tab'){
      const stored=await api.storage.session.get('active-tabs');if(!isCurrent())return false;
      const rows=stored?.['active-tabs'];if(!Array.isArray(rows)||rows.length>512)return false;
      const matching=rows.filter(row=>row?.tabId===tabId);
      if(matching.length!==1||typeof matching[0].documentId!=='string'||!/^[A-Za-z0-9_:.-]{1,128}$/u.test(matching[0].documentId))return false;
      policy.activeDocumentId=matching[0].documentId;
    }
    return policy;
  }catch{return false;}
}
function cancelled(){return new Error('detector-source-changed');}
async function source(api,id){
  if(!Number.isSafeInteger(id)||id<0||id>2147483647)throw cancelled();
  const tab=await api.tabs.get(id);if(tab?.id!==id||typeof tab.url!=='string')throw cancelled();
  const url=new URL(tab.url);if(url.protocol!=='http:'&&url.protocol!=='https:')throw cancelled();return tab;
}
export async function reloadDetectorSource(api,tabId,{isCurrent=()=>true,signal,timeoutMs=15000}={}){
  const current=()=>isCurrent()&&!signal?.aborted;
  if(!current())throw cancelled();
  const before=await source(api,tabId),observation=await readObservationControl(api);
  const verified=await source(api,tabId);if(!current()||verified.url!==before.url)throw cancelled();
  const reconnect=observation.enabled&&observation.scope.scopeMode==='active-tab';
  let completion,dispose=()=>{};
  if(reconnect){
    completion=new Promise(resolve=>{
      let done=false,timer;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);api.tabs.onUpdated?.removeListener(updated);api.tabs.onRemoved?.removeListener(removed);signal?.removeEventListener('abort',abort);resolve(value);};
      const updated=(id,change)=>{if(id===tabId&&change?.status==='complete')finish(true);};
      const removed=id=>{if(id===tabId)finish(false);},abort=()=>finish(false);
      api.tabs.onUpdated?.addListener(updated);api.tabs.onRemoved?.addListener(removed);signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(false),timeoutMs);dispose=()=>finish(false);
    });
  }
  try{
    if(!current())throw cancelled();await api.tabs.reload(tabId);
    if(!current())throw cancelled();
    if(!reconnect)return{reloaded:true,lateAttached:false};
    if(!await completion||!current())throw cancelled();
    await source(api,tabId);if(!current())throw cancelled();
    const state=await readObservationControl(api);if(!current()||!state.enabled||state.scope.scopeMode!=='active-tab')throw cancelled();
    const reply=await api.runtime.sendMessage({schemaVersion:1,type:'ui-inject-now',tabId});
    if(!current())throw cancelled();
    return{reloaded:true,lateAttached:reply?.schemaVersion===1&&reply.type==='ok',accessFailed:reply?.type!=='ok'};
  }finally{dispose();}
}
