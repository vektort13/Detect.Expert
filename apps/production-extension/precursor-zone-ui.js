// ADR-076: independently validated zone configuration; a missing reply never means Off.
import { readPrecursorZoneRequest, readPrecursorZoneSnapshot } from './precursor-modes-contracts.js';
export function createPrecursorZoneUi({h,useState,useEffect,useRef,useLocale,browserApi,translate}) {
  let physical=null;
  const text=key=>translate('precursor_modes_'+key);
  function PrecursorZone({session,enabled=true}) {
    const locale=useLocale?.()??'en',direction=/^(ar|ur)(?:[-_]|$)/i.test(locale)?'rtl':'ltr';
    const dateLocale=({zh_CN:'zh-CN',pt_BR:'pt-BR',yue:'zh-CN',wuu:'zh-CN'})[locale]??locale;
    const date=(at,withDate=false)=>{
      if(!Number.isSafeInteger(at)||at<0||at>8640000000000000)return '—';
      try{return new Intl.DateTimeFormat(dateLocale,{...(withDate?{dateStyle:'medium'}:{}),timeStyle:'medium'}).format(at);}
      catch{return new Date(at).toISOString();}
    };
    const request=readPrecursorZoneRequest({schemaVersion:1,type:'ui-get-precursor-zone',tabId:session?.tabId,frameId:session?.selectedFrameId,documentKey:session?.report?.documentKey});
    const identity=JSON.stringify([request?.documentKey,session?.report?.observedSince,session?.busy,session?.loaded,session?.report?.coverageState,enabled]);
    const boundary=useRef({identity});if(boundary.current.identity!==identity)boundary.current={identity};
    const scope=boundary.current,latest=useRef(scope);latest.current=scope;
    const [value,setValue]=useState(null);
    useEffect(()=>{
      let disposed=false,timer=null,waitTimer=null;
      const current=()=>!disposed&&latest.current===scope;
      if(!request||!enabled||!session?.loaded||session?.busy||['paused','unsupported','no-access'].includes(session?.report?.coverageState))return()=>{disposed=true;};
      waitTimer=setTimeout(()=>{if(current())setValue(null);},6000);
      const read=()=>{
        if(!current()||physical)return;
        clearTimeout(waitTimer);waitTimer=null;
        const operation={expired:false};physical=operation;
        timer=setTimeout(()=>{operation.expired=true;if(current())setValue(null);},6000);
        const settle=raw=>{
          clearTimeout(timer);if(physical===operation)physical=null;
          if(!current()||operation.expired)return;
          const reply=readPrecursorZoneSnapshot(raw);
          setValue(reply?.documentKey===request.documentKey?{scope,state:reply.state}:null);
        };
        try{Promise.resolve(browserApi.runtime.sendMessage(request)).then(settle,()=>settle(null));}catch{settle(null);}
      };
      read();const interval=setInterval(read,5000);
      return()=>{disposed=true;clearTimeout(timer);clearTimeout(waitTimer);clearInterval(interval);};
    },[scope]);
    const state=value?.scope===scope?value.state:null;
    if(!state?.zoneName)return null;
    const changed=state.lastChange,mode=state.mode;
    return h('div',{class:'precursor-zone',dir:direction,'data-zone-visible':true,'data-zone-mode':mode,role:'status',children:[
      h('div',{class:'precursor-zone__mode',children:[text('zone_mode')+' ('+text('source')+')',': ',h('strong',{dir:'auto',children:text('mode_'+mode)})]}),
      h('div',{class:'precursor-zone__details',children:[h('bdi',{dir:'ltr',children:state.zoneName}),state.checkedAt!==null?h('span',{children:[' · '+text('last_checked')+': ',h('bdi',{'data-zone-checked':true,children:date(state.checkedAt)})]}):null]}),
      changed?h('div',{'data-zone-change':true,children:[text('changed'),': ',h('span',{class:'precursor-zone__transition',dir:direction,'data-zone-transition':true,children:[h('bdi',{children:text('mode_'+changed.from)}),h('span',{children:direction==='rtl'?'←':'→'}),h('bdi',{children:text('mode_'+changed.to)})]}),' · ',h('bdi',{'data-zone-changed-at':true,children:date(changed.at,true)})]}):null
    ]});
  }
  return {PrecursorZone};
}
