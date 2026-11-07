// DET-CF-PRECURSOR-001 / ADR-076: own-UI configuration, never a page-provided mode.
export const PRECURSOR_MODES_PORT = 'detect-expert-precursor-modes-v1';
export const PRECURSOR_MODES = Object.freeze(['off', 'monitor', 'arm']);
export const PRECURSOR_MODE_ERRORS = Object.freeze(['invalid-input','unauthorized','consent-required','busy','disconnected','cooldown','permission-required','notifications-unavailable','session-unavailable','api-unauthorized','api-forbidden','api-not-found','rate-limited','api-unavailable','network-error','timeout','invalid-response','response-too-large','storage-unavailable','clock-changed']);
const statuses = ['disconnected','connecting','ready','stale','error'];
const own = (value,key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value,key)?.value : undefined;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value,keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
  const field = Object.getOwnPropertyDescriptor(value,key); return field?.enumerable && Object.hasOwn(field,'value');
});
export function readModesCommand(value) {
  try {
    const action=own(value,'action');
    const extra=action==='connect'?['zoneId','token']:action==='notifications'?['enabled']:[];
    if(!['read','connect','disconnect','refresh','notifications'].includes(action) || !exact(value,['schemaVersion','id','action',...extra]) || own(value,'schemaVersion')!==1 || !integer(own(value,'id')))return null;
    const result={schemaVersion:1,id:own(value,'id'),action};
    if(action==='connect') {
      const zoneId=own(value,'zoneId'),token=own(value,'token');
      if(typeof zoneId!=='string'||!/^[a-fA-F0-9]{32}$/.test(zoneId)||typeof token!=='string'||!/^[\x21-\x7e]{1,2048}$/.test(token))return null;
      return {...result,zoneId:zoneId.toLowerCase(),token};
    }
    if(action==='notifications'){if(typeof own(value,'enabled')!=='boolean')return null;result.enabled=own(value,'enabled');}
    return result;
  }catch{return null;}
}
export function readModesState(value) {
  try {
    const keys=['status','zone','mode','checkedAt','lastKnownMode','lastKnownAt','errorCode','history','notifications','connected'];
    if(!exact(value,keys)||!statuses.includes(own(value,'status'))||typeof own(value,'notifications')!=='boolean'||typeof own(value,'connected')!=='boolean')return null;
    const mode=own(value,'mode'),lastKnownMode=own(value,'lastKnownMode'),checkedAt=own(value,'checkedAt'),lastKnownAt=own(value,'lastKnownAt'),errorCode=own(value,'errorCode');
    if(!['unknown',...PRECURSOR_MODES].includes(mode)||!['unknown',...PRECURSOR_MODES].includes(lastKnownMode)||checkedAt!==null&&!integer(checkedAt)||lastKnownAt!==null&&!integer(lastKnownAt)||errorCode!==null&&!PRECURSOR_MODE_ERRORS.includes(errorCode))return null;
    const rawZone=own(value,'zone');let zone=null;
    if(rawZone!==null){
      if(!exact(rawZone,['id','name']))return null;
      const id=own(rawZone,'id'),name=own(rawZone,'name');
      if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||typeof name!=='string'||name.length>253||!name.includes('.')||!name.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return null;
      zone={id,name};
    }
    if(mode!=='unknown'&&(!zone||!own(value,'connected')||own(value,'status')!=='ready'||checkedAt===null))return null;
    if(own(value,'status')==='ready'&&mode==='unknown')return null;
    if(lastKnownMode==='unknown'?lastKnownAt!==null:!zone||lastKnownAt===null)return null;
    const input=own(value,'history'),length=own(input,'length'),history=[];
    if(!Array.isArray(input)||!integer(length)||length>128||Reflect.ownKeys(input).length!==length+1)return null;
    let previous=0;
    for(let index=0;index<length;index++) {
      const entry=own(input,String(index));
      if(!exact(entry,['id','from','to','at']))return null;
      const id=own(entry,'id'),from=own(entry,'from'),to=own(entry,'to'),at=own(entry,'at');
      if(!integer(id)||id<=previous||!PRECURSOR_MODES.includes(from)||!PRECURSOR_MODES.includes(to)||from===to||!integer(at))return null;
      previous=id;history.push({id,from,to,at});
    }
    return {status:own(value,'status'),zone,mode,checkedAt,lastKnownMode,lastKnownAt,errorCode,history,notifications:own(value,'notifications'),connected:own(value,'connected')};
  }catch{return null;}
}
export function readModesReply(value) {
  try {
    if(!exact(value,['schemaVersion','id','ok','state','errorCode'])||own(value,'schemaVersion')!==1||!integer(own(value,'id'))||typeof own(value,'ok')!=='boolean')return null;
    const state=readModesState(own(value,'state')),errorCode=own(value,'errorCode');
    if(!state||errorCode!==null&&!PRECURSOR_MODE_ERRORS.includes(errorCode))return null;
    return {schemaVersion:1,id:own(value,'id'),ok:own(value,'ok'),state,errorCode};
  }catch{return null;}
}
export function readPrecursorZoneRequest(value) {
  try {
    if(!exact(value,['schemaVersion','type','tabId','frameId','documentKey'])||own(value,'schemaVersion')!==1||own(value,'type')!=='ui-get-precursor-zone')return null;
    const tabId=own(value,'tabId'),frameId=own(value,'frameId'),key=own(value,'documentKey');
    if(!integer(tabId)||!integer(frameId)||typeof key!=='string'||key.length>160||!key.startsWith(`${tabId}:${frameId}:`)||!/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):[A-Za-z0-9_-]{1,64}$/.test(key))return null;
    return {schemaVersion:1,type:'ui-get-precursor-zone',tabId,frameId,documentKey:key};
  }catch{return null;}
}
export function readPrecursorZoneSnapshot(value) {
  try {
    if(!exact(value,['schemaVersion','type','documentKey','state'])||own(value,'schemaVersion')!==1||own(value,'type')!=='precursor-zone-state')return null;
    const key=own(value,'documentKey');
    if(typeof key!=='string'||key.length>160||!/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):[A-Za-z0-9_-]{1,64}$/.test(key))return null;
    const raw=own(value,'state');let state=null;
    if(raw!==null){
      if(!exact(raw,['status','zoneName','mode','checkedAt','lastChange']))return null;
      const status=own(raw,'status'),zoneName=own(raw,'zoneName'),mode=own(raw,'mode'),checkedAt=own(raw,'checkedAt'),last=own(raw,'lastChange');
      if(!statuses.includes(status)||typeof zoneName!=='string'||zoneName.length>253||!zoneName.includes('.')||!zoneName.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||!['unknown',...PRECURSOR_MODES].includes(mode)||checkedAt!==null&&!integer(checkedAt))return null;
      if(mode!=='unknown'&&(status!=='ready'||checkedAt===null)||status==='ready'&&mode==='unknown')return null;
      let lastChange=null;
      if(last!==null){if(!exact(last,['from','to','at'])||!PRECURSOR_MODES.includes(own(last,'from'))||!PRECURSOR_MODES.includes(own(last,'to'))||own(last,'from')===own(last,'to')||!integer(own(last,'at')))return null;lastChange={from:own(last,'from'),to:own(last,'to'),at:own(last,'at')};}
      state={status,zoneName,mode,checkedAt,lastChange};
    }
    return {schemaVersion:1,type:'precursor-zone-state',documentKey:key,state};
  }catch{return null;}
}
