import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

const seed = 'a'.repeat(64);
const candidateText = 'candidate:1 1 UDP 2122260223 192.168.99.7 5000 typ srflx raddr 10.7.8.9 rport 5000 generation 0';
const sdp = 'v=0\r\no=- 1 1 IN IP4 192.168.99.7\r\ns=-\r\nc=IN IP4 192.168.99.7\r\na=' + candidateText + '\r\na=fingerprint:sha-256 AA:BB:CC\r\n';
const profile = overrides => ({ addresses: { ipv4: { host:'192.0.2.10',stun:'198.51.100.20',turn:'203.0.113.30' }, ipv6: { host:'2001:db8::1',stun:'2001:db8::2',turn:'2001:db8::3' } }, iceTransportPolicy:'preserve', randomizeDevices:false, freshCertificates:false, deviceLifetime:'session', ...overrides });
function fixture(value = profile(), extra = [], options = {}) {
  const pcs = new WeakMap(), candidates = new WeakMap(), descriptions = new WeakMap(), devices = new WeakMap(), tracks = new WeakMap();
  const calls = [], invalid = new TypeError('NATIVE_BRAND'), sentinel = new Error('NATIVE_SENTINEL');
  const nativeSdp = options.sdp ?? sdp;
  class RTCIceCandidate {
    constructor(value) { candidates.set(this, { candidate:value.candidate ?? '',type:value.type ?? 'srflx',address:value.address ?? '192.168.99.7',relatedAddress:value.relatedAddress ?? '10.7.8.9',url:'stun:192.168.99.7' }); }
    get candidate() { const value=candidates.get(this);if(!value)throw invalid;return value.candidate; }
    get type() { const value=candidates.get(this);if(!value)throw invalid;return value.type; }
    get foundation() { const value=candidates.get(this);if(!value)throw invalid;return value.candidate.split(' ')[0].replace(/^candidate:/,''); }
    get address() { const value=candidates.get(this);if(!value)throw invalid;return value.address; }
    get relatedAddress() { const value=candidates.get(this);if(!value)throw invalid;return value.relatedAddress; }
    get url() { const value=candidates.get(this);if(!value)throw invalid;return value.url; }
    toJSON() { const value=candidates.get(this);if(!value)throw invalid;return {candidate:value.candidate,sdpMid:'0',sdpMLineIndex:0,usernameFragment:'fixture'}; }
  }
  class RTCSessionDescription {
    constructor(value) { descriptions.set(this,{type:value.type,sdp:value.sdp}); }
    get type() { const value=descriptions.get(this);if(!value)throw invalid;return value.type; }
    get sdp() { const value=descriptions.get(this);if(!value)throw invalid;return value.sdp; }
    toJSON() { const value=descriptions.get(this);if(!value)throw invalid;return {...value}; }
  }
  const nativeMap = Object.fromEntries(['get','has','keys','values','entries','forEach'].map(key=>[key,Map.prototype[key]])), iterator=Map.prototype[Symbol.iterator];
  const statReports=new WeakMap();const reportMap=receiver=>{const map=statReports.get(receiver);if(!map)throw invalid;return map;};
  class RTCStatsReport {
    constructor(entries){statReports.set(this,new Map(entries));}
    get(key) { const map=reportMap(this);if(!arguments.length)throw invalid;const converted=String(key);calls.push(['stats-get',converted]);return Reflect.apply(nativeMap.get,map,[converted]); }
    has(key) { const map=reportMap(this);if(!arguments.length)throw invalid;const converted=String(key);calls.push(['stats-has',converted]);return Reflect.apply(nativeMap.has,map,[converted]); }
    keys() { return Reflect.apply(nativeMap.keys,reportMap(this),arguments); }
    values() { return Reflect.apply(nativeMap.values,reportMap(this),arguments); }
    entries() { return Reflect.apply(nativeMap.entries,reportMap(this),arguments); }
    forEach(callback,thisArg) { const map=reportMap(this);if(typeof callback!=='function')throw invalid;return Reflect.apply(nativeMap.forEach,map,[(value,key)=>Reflect.apply(callback,thisArg,[value,key,this])]); }
    [Symbol.iterator]() { return Reflect.apply(iterator,reportMap(this),arguments); }
  }
  class RTCPeerConnection {
    constructor(config = {}) {
      if(config===sentinel)throw sentinel;
      const policy=config.iceTransportPolicy ?? 'all', certificates=config.certificates ?? [{kind:'native-fresh'}];
      const bundlePolicy=config.bundlePolicy; pcs.set(this,{policy,certificates,bundlePolicy});calls.push(['construct',config]);
    }
    getConfiguration() { const value=pcs.get(this);if(!value)throw invalid;calls.push(['configuration']);return {iceTransportPolicy:value.policy,certificates:value.certificates}; }
    setConfiguration(config) { const value=pcs.get(this);if(!value)throw invalid;calls.push(['setConfiguration']);value.policy=config.iceTransportPolicy ?? value.policy;void config.certificates; }
    createOffer(callback) { if(!pcs.has(this))return Promise.reject(invalid);calls.push(['offer',...arguments]);const value={type:'offer',sdp:nativeSdp};return typeof callback==='function'?Promise.resolve().then(()=>{callback(value);}):Promise.resolve(value); }
    createAnswer(callback) { if(!pcs.has(this))return Promise.reject(invalid);calls.push(['answer',...arguments]);const value={type:'answer',sdp:nativeSdp};return typeof callback==='function'?Promise.resolve().then(()=>{callback(value);}):Promise.resolve(value); }
    setLocalDescription(value) { const state=pcs.get(this);if(!state)return Promise.reject(invalid);calls.push(['local']);state.local={type:value.type,sdp:value.sdp};return Promise.resolve(); }
    setRemoteDescription(value) { const state=pcs.get(this);if(!state)return Promise.reject(invalid);calls.push(['remote']);state.remote={type:value.type,sdp:value.sdp};return Promise.resolve(); }
    addIceCandidate(value) { if(!pcs.has(this))return Promise.reject(invalid);calls.push(['candidate',value?.candidate]);return Promise.resolve(); }
    get localDescription() { const value=pcs.get(this);if(!value)throw invalid;return value.local?new RTCSessionDescription(value.local):null; }
    get currentLocalDescription() { return this.localDescription; }
    get pendingLocalDescription() { return this.localDescription; }
    get remoteDescription() { const value=pcs.get(this);if(!value)throw invalid;return value.remote?new RTCSessionDescription(value.remote):null; }
    get currentRemoteDescription() { return this.remoteDescription; }
    get pendingRemoteDescription() { return this.remoteDescription; }
    getStats() {
      if(!pcs.has(this))return Promise.reject(invalid);calls.push(['stats']);
      return Promise.resolve(new (options.plainStats?Map:RTCStatsReport)([
        ['candidate-192.168.99.7',{id:'candidate-192.168.99.7',type:'local-candidate',candidateType:'srflx',address:'192.168.99.7',port:5000,url:'stun:192.168.99.7',googLocalAddress:'192.168.99.7',protocol:'udp'}],
        ['pair',{id:'pair',type:'candidate-pair',localCandidateId:'candidate-192.168.99.7',remoteCandidateId:'remote',state:'succeeded',bytesSent:9}]
      ]));
    }
  }
  class MediaDeviceInfo {
    constructor(id='native-device',group='native-group',kind='audioinput',label='Private microphone') { devices.set(this,{deviceId:id,groupId:group,kind,label}); }
    get deviceId() { const value=devices.get(this);if(!value)throw invalid;return value.deviceId; }
    get groupId() { const value=devices.get(this);if(!value)throw invalid;return value.groupId; }
    get kind() { const value=devices.get(this);if(!value)throw invalid;return value.kind; }
    get label() { const value=devices.get(this);if(!value)throw invalid;return value.label; }
    toJSON() { const value=devices.get(this);if(!value)throw invalid;return {...value}; }
  }
  class InputDeviceInfo extends MediaDeviceInfo { getCapabilities() { const value=devices.get(this);if(!value)throw invalid;return {deviceId:value.deviceId,groupId:value.groupId,sampleRate:[48000]}; } }
  class MediaStreamTrack {
    constructor() { tracks.set(this,{deviceId:'native-device',groupId:'native-group',kind:'audio',label:'Private microphone',constraints:{}}); }
    get kind() { const value=tracks.get(this);if(!value)throw invalid;return value.kind; }
    get label() { const value=tracks.get(this);if(!value)throw invalid;return value.label; }
    getSettings() { const value=tracks.get(this);if(!value)throw invalid;return {deviceId:value.deviceId,groupId:value.groupId,sampleRate:48000}; }
    getCapabilities() { return this.getSettings(); }
    getConstraints() { const value=tracks.get(this);if(!value)throw invalid;return value.constraints; }
    applyConstraints(value) { const state=tracks.get(this);if(!state)throw invalid;const device=value.deviceId;state.constraints={deviceId:{exact:device.exact}};calls.push(['constraints',device.exact]);return Promise.resolve(); }
  }
  class MediaDevices {
    enumerateDevices() { return Promise.resolve([new InputDeviceInfo()]); }
    getUserMedia(value) { const audio=value.audio;const selected=audio.deviceId;calls.push(['gUM',typeof selected==='string'?selected:selected.exact]);return Promise.resolve(new MediaStreamTrack()); }
  }
  const audioContexts=new WeakMap();
  class AudioContext {
    constructor(options={}) { const sink=options.sinkId??'';audioContexts.set(this,sink);calls.push(['audio-construct',sink]); }
    get sinkId() { if(!audioContexts.has(this))throw invalid;return audioContexts.get(this); }
    setSinkId(value) { if(!audioContexts.has(this))throw invalid;audioContexts.set(this,value);calls.push(['sink',value]);return Promise.resolve(); }
  }
  const ports=new WeakMap(),midiMaps=new WeakMap();
  class MIDIPort{
    constructor(id='native-midi',name='Private MIDI Port'){ports.set(this,{id,name,manufacturer:'Private manufacturer',version:'Private version'});}
    get id(){const row=ports.get(this);if(!row)throw invalid;return row.id;}
    get name(){const row=ports.get(this);if(!row)throw invalid;return row.name;}
    get manufacturer(){const row=ports.get(this);if(!row)throw invalid;return row.manufacturer;}
    get version(){const row=ports.get(this);if(!row)throw invalid;return row.version;}
    send(value){if(!ports.has(this))throw invalid;calls.push(['midi-send',value]);}
  }
  function midiMapClass(){return class{
    constructor(entries=[]){midiMaps.set(this,new Map(entries));}
    get size(){const map=midiMaps.get(this);if(!map)throw invalid;return map.size;}
    get(key){const map=midiMaps.get(this);if(!map)throw invalid;if(!arguments.length)throw invalid;const nativeKey=String(key);calls.push(['midi-get',nativeKey]);return map.get(nativeKey);}
    has(key){const map=midiMaps.get(this);if(!map)throw invalid;if(!arguments.length)throw invalid;const nativeKey=String(key);calls.push(['midi-has',nativeKey]);return map.has(nativeKey);}
    keys(){const map=midiMaps.get(this);if(!map)throw invalid;calls.push(['midi-keys']);return map.keys();}
    values(){const map=midiMaps.get(this);if(!map)throw invalid;calls.push(['midi-values']);return map.values();}
    entries(){const map=midiMaps.get(this);if(!map)throw invalid;calls.push(['midi-entries']);return map.entries();}
    forEach(callback,thisArg){const map=midiMaps.get(this);if(!map)throw invalid;if(typeof callback!=='function')throw invalid;calls.push(['midi-forEach']);map.forEach((value,key)=>Reflect.apply(callback,thisArg,[value,key,this]));}
    [Symbol.iterator](){const map=midiMaps.get(this);if(!map)throw invalid;return map.entries();}
  };}
  const MIDIInputMap=midiMapClass(),MIDIOutputMap=midiMapClass();
  class BluetoothDevice{get name(){return 'Private Bluetooth Name';}get id(){return 'native-bluetooth';}}
  class BluetoothAdvertisingEvent{get name(){return 'Private Bluetooth Name';}}
  class USBConfiguration{get configurationName(){return 'Private USB configuration';}}
  class USBAlternateInterface{get interfaceName(){return 'Private USB interface';}}
  const realm = {Object,Array,Promise,RTCPeerConnection,webkitRTCPeerConnection:RTCPeerConnection,mozRTCPeerConnection:RTCPeerConnection,RTCIceCandidate,RTCSessionDescription,RTCStatsReport,MediaDeviceInfo,InputDeviceInfo,MediaStreamTrack,MediaDevices,AudioContext,webkitAudioContext:AudioContext,MIDIPort,MIDIInputMap,MIDIOutputMap,BluetoothDevice,BluetoothAdvertisingEvent,USBConfiguration,USBAlternateInterface,DOMException,location:{origin:options.origin??'https://fixture.example'}};
  const installation=installWebRtcCustom(realm,[{id:'webrtc',mode:'custom',value,deviceSeed:Object.hasOwn(options,'seed')?options.seed:seed},...extra]);
  return {realm,installation,calls,pcs,candidates,invalid,sentinel,midiMaps};
}

test('candidate getters, borrowed toJSON and SDP all use selected addresses without changing native certificate fingerprint',async()=>{
  const f=fixture(), candidate=new f.realm.RTCIceCandidate({candidate:candidateText});
  const text=candidate.candidate;assert.ok(text.includes('198.51.100.20'));assert.ok(text.includes('raddr 192.0.2.10'));assert.equal(candidate.address,'198.51.100.20');
  assert.equal(candidate.relatedAddress,'192.0.2.10');assert.equal(candidate.url,'');
  assert.equal(text.split(' ')[0],'candidate:'+candidate.foundation);assert.notEqual(candidate.foundation,'1');
  assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(candidate).candidate,text);
  const pc=new f.realm.RTCPeerConnection(), offer=await pc.createOffer();
  assert.ok(offer.sdp.includes('a=fingerprint:sha-256 AA:BB:CC'));assert.equal(offer.sdp.includes('192.168.99.7'),false);
  await pc.setLocalDescription(offer);assert.equal(f.pcs.get(pc).local.sdp,sdp,'only native setter receives private original');
  assert.equal(pc.localDescription.sdp,offer.sdp);assert.equal(pc.localDescription.toJSON().sdp,offer.sdp);
  await pc.addIceCandidate(candidate.toJSON());assert.equal(f.calls.find(row=>row[0]==='candidate')[1],candidateText);
  assert.equal(f.calls.filter(row=>row[0]==='offer').length,1);
});

test('stats getters, iterators, forEach and prototype-call retain safe IDs and candidate relationships',async()=>{
  const f=fixture(), pc=new f.realm.RTCPeerConnection(), report=await pc.getStats();
  const values=[...report.values()], pairs=[...report], serialized=JSON.stringify({values,pairs,keys:[...report.keys()]});
  assert.equal(serialized.includes('192.168.99.7'),false);assert.equal(serialized.includes('googLocalAddress'),false);assert.ok(serialized.includes('198.51.100.20'));
  const candidate=values.find(row=>row.type==='local-candidate'), pair=values.find(row=>row.type==='candidate-pair');
  assert.equal(pair.localCandidateId,candidate.id);assert.equal(report.get(candidate.id),candidate);assert.equal(f.realm.RTCStatsReport.prototype.get.call(report,candidate.id),candidate);
  let count=0;report.forEach((value,key,receiver)=>{count++;assert.equal(receiver,report);assert.equal(value.id,key);});assert.equal(count,2);
});

test('WebIDL stats object keys coerce once with original receiver and preserve native brand/argument/exception ordering',async()=>{
  const f=fixture(),report=await new f.realm.RTCPeerConnection().getStats(),row=[...report.values()][0];let getCalls=0,hasCalls=0;
  const key={get [Symbol.toPrimitive](){getCalls++;return function(hint){assert.equal(this,key);assert.equal(hint,'string');return row.id;};}};
  assert.equal(report.get(key),row);assert.equal(getCalls,1);assert.equal(f.calls.filter(row=>row[0]==='stats-get').length,1);
  assert.equal(report.has({toString(){hasCalls++;return row.id;}}),true);assert.equal(hasCalls,1);assert.equal(f.calls.filter(row=>row[0]==='stats-has').length,1);
  let reads=0;assert.throws(()=>f.realm.RTCStatsReport.prototype.get.call({},{toString(){reads++;return row.id;}}),error=>error===f.invalid);assert.equal(reads,0);
  assert.throws(()=>report.get(),error=>error===f.invalid);const sentinel=new Error('coercion');assert.throws(()=>report.get({toString(){throw sentinel;}}),error=>error===sentinel);
});

test('fresh certificates and relay are real native configuration overrides, ignoring caller getters exactly',()=>{
  const f=fixture(profile({addresses:null,freshCertificates:true,iceTransportPolicy:'relay'}));let certReads=0,policyReads=0,otherReads=0;
  const pc=new f.realm.RTCPeerConnection({get certificates(){certReads++;throw Error('ignored');},get iceTransportPolicy(){policyReads++;throw Error('ignored');},get bundlePolicy(){otherReads++;return 'balanced';}});
  assert.equal(certReads,0);assert.equal(policyReads,0);assert.equal(otherReads,1);
  assert.equal(pc.getConfiguration().iceTransportPolicy,'relay');assert.equal(pc.getConfiguration().certificates[0].kind,'native-fresh');
  assert.equal(f.realm.RTCPeerConnection.prototype.constructor,f.realm.RTCPeerConnection);assert.equal(f.realm.webkitRTCPeerConnection,f.realm.RTCPeerConnection);assert.equal(f.realm.mozRTCPeerConnection,f.realm.RTCPeerConnection);
  class Child extends f.realm.RTCPeerConnection{}assert.ok(new Child() instanceof Child);
});

test('device aliases match SHA-256 seed/origin derivation and round-trip native constraints/settings without fake handles',async()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true})), devices=new f.realm.MediaDevices(), [device]=await devices.enumerateDevices();
  const expected=createHash('sha256').update(seed+':23:https://fixture.example:device:13:native-device').digest('hex');
  assert.equal(device.deviceId,expected);assert.ok(device instanceof f.realm.MediaDeviceInfo);
  const json=device.toJSON();assert.equal(json.deviceId,expected);assert.equal(json.label,device.label);
  let reads=0;const track=await devices.getUserMedia({get audio(){reads++;return {deviceId:{exact:device.deviceId}};}});
  assert.equal(reads,1);assert.ok(track instanceof f.realm.MediaStreamTrack);assert.equal(f.calls.find(row=>row[0]==='gUM')[1],'native-device');
  assert.equal(track.getSettings().deviceId,expected);assert.equal(track.label,device.label);
  assert.equal(device.getCapabilities().deviceId,expected);
  await track.applyConstraints({deviceId:{exact:expected}});assert.equal(f.calls.find(row=>row[0]==='constraints')[1],'native-device');
  assert.equal(track.getConstraints().deviceId.exact,expected);
  const second=fixture(profile({addresses:null,randomizeDevices:true}));assert.equal(new second.realm.MediaDeviceInfo().deviceId,expected);
});

test('native illegal receiver/exception identity survive and no observer channel or page-controlled toJSON is read',async()=>{
  const f=fixture();assert.throws(()=>Reflect.apply(Object.getOwnPropertyDescriptor(f.realm.RTCIceCandidate.prototype,'address').get,{},[]),error=>error===f.invalid);
  await assert.rejects(Reflect.apply(f.realm.RTCPeerConnection.prototype.createOffer,{},[]),error=>error===f.invalid);
  const metadata=new Proxy({},{get(){throw Error('unread');}});const pc=new f.realm.RTCPeerConnection();
  await pc.createOffer(metadata);assert.equal(f.calls.filter(row=>row[0]==='offer').length,1);
});

test('stop restores owned descriptors, preserves page replacements, and retained wrappers forward native once',async()=>{
  const f=fixture(), pc=new f.realm.RTCPeerConnection(), retained=pc.createOffer;
  const replacement=()=>Promise.resolve({type:'offer',sdp:'page'});f.realm.RTCPeerConnection.prototype.createAnswer=replacement;
  f.installation.stop();assert.equal(f.realm.RTCPeerConnection.prototype.createAnswer,replacement);
  assert.equal((await Reflect.apply(retained,pc,[])).sdp,sdp);assert.equal(f.calls.filter(row=>row[0]==='offer').length,1);
  assert.equal(f.installation.snapshot().stopped,true);
});

test('native legacy offer/answer callbacks receive projected descriptions and Promise<void> success stays fulfilled',async()=>{
  const f=fixture(),pc=new f.realm.RTCPeerConnection();
  for(const method of ['createOffer','createAnswer']){
    let calls=0,received;const promise=pc[method](value=>{calls++;received=value;},()=>assert.fail('unexpected error callback'));
    assert.ok(promise instanceof Promise);assert.equal(await promise,undefined);assert.equal(calls,1);assert.equal(received.sdp.includes('192.168.99.7'),false);
  }
});

test('AudioContext sink selectors round-trip aliases while native silent AudioSinkInfo identity stays intact',async()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true})),device=new f.realm.MediaDeviceInfo(),alias=device.deviceId;
  let reads=0;const audio=new f.realm.AudioContext({get sinkId(){reads++;return alias;}});
  assert.equal(reads,1);assert.equal(f.calls.find(row=>row[0]==='audio-construct')[1],'native-device');assert.equal(audio.sinkId,alias);
  await audio.setSinkId(alias);assert.equal(f.calls.find(row=>row[0]==='sink')[1],'native-device');
  const silent={type:'none'};await audio.setSinkId(silent);assert.equal(audio.sinkId,silent);
  assert.equal(f.realm.AudioContext,f.realm.webkitAudioContext);assert.equal(f.realm.AudioContext.prototype.constructor,f.realm.AudioContext);
});

test('missing seed and forged conflicting media profile withhold identities; origins and browser-session seeds separate aliases',async()=>{
  for(const options of [{seed:undefined},{seed:'invalid'}]){
    const f=fixture(profile({addresses:null,randomizeDevices:true}),[],options),device=new f.realm.MediaDeviceInfo();
    assert.equal(device.deviceId,'');assert.equal(device.groupId,'');assert.equal(device.label,'');assert.equal(device.toJSON().deviceId,'');assert.ok(f.installation.snapshot().unavailable>0);
  }
  const conflict=fixture(profile({addresses:null,randomizeDevices:true}),[{id:'media-enumeration',mode:'custom',value:[]}]);assert.equal(new conflict.realm.MediaDeviceInfo().deviceId,'');
  const a=fixture(profile({addresses:null,randomizeDevices:true})),b=fixture(profile({addresses:null,randomizeDevices:true}),[],{seed:'b'.repeat(64)}),c=fixture(profile({addresses:null,randomizeDevices:true}),[],{origin:'https://different.example'});
  const aliases=[new a.realm.MediaDeviceInfo().deviceId,new b.realm.MediaDeviceInfo().deviceId,new c.realm.MediaDeviceInfo().deviceId];assert.equal(new Set(aliases).size,3);
});

test('IPv6 selected addresses cover candidate, SDP family and malformed/oversized candidate fail-closed paths',async()=>{
  const native6=candidateText.replaceAll('192.168.99.7','fd00::123').replaceAll('10.7.8.9','fd00::456');
  const f=fixture(profile(),[],{sdp:sdp.replaceAll('IP4','IP6').replaceAll('192.168.99.7','fd00::123').replaceAll('10.7.8.9','fd00::456')});
  const candidate=new f.realm.RTCIceCandidate({candidate:native6,address:'fd00::123',relatedAddress:'fd00::456'});assert.equal(candidate.address,'2001:db8::2');assert.ok(candidate.candidate.includes('raddr 2001:db8::1'));
  const offer=await new f.realm.RTCPeerConnection().createOffer();assert.ok(offer.sdp.includes('IN IP6 2001:db8::1'));assert.equal(offer.sdp.includes('192.168.99.7'),false);
  for(const value of ['unclassified 192.168.99.7','candidate:'+ 'x'.repeat(5000)])assert.equal(new f.realm.RTCIceCandidate({candidate:value}).candidate,'');
});

test('later child installation and SHA mapping use captured intrinsics after page poisons ambient array iteration',()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true}));f.installation.stop();
  const previous=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator);let installation,alias;
  try{
    Object.defineProperty(Array.prototype,Symbol.iterator,{...previous,value(){throw Error('PAGE_ITERATOR');}});
    installation=installWebRtcCustom(f.realm,[{id:'webrtc',mode:'custom',value:profile({addresses:null,randomizeDevices:true}),deviceSeed:seed}]);
    alias=new f.realm.MediaDeviceInfo().deviceId;
  }finally{Object.defineProperty(Array.prototype,Symbol.iterator,previous);}
  assert.match(alias,/^[a-f0-9]{64}$/);assert.equal(installation.snapshot().unavailable,0);installation.stop();
});

test('native Map-style RTC stats never patch shared Map methods or alter unrelated Maps',async()=>{
  const before=Object.fromEntries(['get','has','keys','values','entries','forEach'].map(key=>[key,Map.prototype[key]]));
  const sentinel={native:true},ordinary=new Map([['sentinel',sentinel]]),f=fixture(profile(),[],{plainStats:true});
  const report=await new f.realm.RTCPeerConnection().getStats();assert.ok(report instanceof Map);assert.equal(JSON.stringify([...report]).includes('192.168.99.7'),false);
  for(const key of Object.keys(before))assert.equal(Map.prototype[key],before[key]);
  assert.equal(ordinary.get('sentinel'),sentinel);assert.equal(ordinary.has('sentinel'),true);assert.deepEqual([...ordinary.keys()],['sentinel']);assert.equal([...ordinary.values()][0],sentinel);assert.equal([...ordinary.entries()][0][1],sentinel);
  let count=0;ordinary.forEach((value,key,map)=>{assert.equal(value,sentinel);assert.equal(key,'sentinel');assert.equal(map,ordinary);count++;});assert.equal(count,1);
});

test('Bluetooth advertisement names and USB descriptor names use consistent native identity aliases',()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true}));
  const device=new f.realm.BluetoothDevice(),event=new f.realm.BluetoothAdvertisingEvent();assert.equal(event.name,device.name);assert.notEqual(device.name,'Private Bluetooth Name');
  assert.notEqual(new f.realm.USBConfiguration().configurationName,'Private USB configuration');assert.notEqual(new f.realm.USBAlternateInterface().interfaceName,'Private USB interface');
});

test('MIDI map aliases match native port IDs across get/has/all iterators and forEach without fake handles or I/O',()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true}));
  for(const name of ['MIDIInputMap','MIDIOutputMap']){
    const port=new f.realm.MIDIPort(),map=new f.realm[name]([['native-midi',port]]),alias=port.id;
    assert.match(alias,/^[a-f0-9]{64}$/);assert.equal(map.get(alias),port);assert.equal(map.has(alias),true);assert.equal(map.size,1);
    assert.deepEqual([...map.keys()],[alias]);assert.deepEqual([...map.entries()],[[alias,port]]);assert.deepEqual([...map],[[alias,port]]);assert.equal([...map.values()][0],port);
    const receiver={native:true};let calls=0;map.forEach(function(value,key,actual){assert.equal(this,receiver);assert.equal(value,port);assert.equal(key,alias);assert.equal(actual,map);calls++;},receiver);assert.equal(calls,1);
    assert.equal(port instanceof f.realm.MIDIPort,true);for(const key of ['manufacturer','name','version'])assert.equal(port[key].includes('Private'),false);
  }
  assert.equal(f.calls.some(row=>row[0]==='midi-send'),false);
});

test('MIDI live iterators and key coercion preserve native once/exception/receiver semantics and refuse raw borrowed-next escape',()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true})),first=new f.realm.MIDIPort(),map=new f.realm.MIDIInputMap([['native-midi',first]]),alias=first.id;
  let coercions=0;const key={[Symbol.toPrimitive](hint){assert.equal(this,key);assert.equal(hint,'string');coercions++;return alias;}};
  assert.equal(map.get(key),first);assert.equal(coercions,1);assert.equal(f.calls.filter(row=>row[0]==='midi-get').length,1);
  assert.throws(()=>f.realm.MIDIInputMap.prototype.get.call({},key),error=>error===f.invalid);assert.equal(coercions,1);
  const sentinel=new Error('native coercion');assert.throws(()=>map.get({toString(){throw sentinel;}}),error=>error===sentinel);
  const iterator=map.entries();assert.deepEqual(iterator.next().value,[alias,first]);
  const second=new f.realm.MIDIPort('native-second');f.midiMaps.get(map).set('native-second',second);assert.deepEqual(iterator.next().value,[second.id,second]);
  const nativeNext=Object.getPrototypeOf(iterator).next;assert.throws(()=>nativeNext.call(iterator),TypeError);
  const callbackError=new Error('callback');assert.throws(()=>map.forEach(()=>{throw callbackError;}),error=>error===callbackError);
});

test('MIDI alias from an earlier installation resolves by bounded metadata lookup in a fresh private inverse map',()=>{
  const f=fixture(profile({addresses:null,randomizeDevices:true})),port=new f.realm.MIDIPort(),map=new f.realm.MIDIInputMap([['native-midi',port]]),alias=port.id;
  f.installation.stop();const second=installWebRtcCustom(f.realm,[{id:'webrtc',mode:'custom',value:profile({addresses:null,randomizeDevices:true}),deviceSeed:seed}]);
  assert.equal(map.get(alias),port);assert.equal(f.calls.filter(row=>row[0]==='midi-get').length,1);assert.equal(port.id,alias);second.stop();
});

test('ADR-112: the RTCPeerConnection constructor wrapper refuses a prototype cycle with the engine TypeError, forwards other prototypes and still constructs',()=>{
  const f=fixture(profile({addresses:null,freshCertificates:true}));const wrapper=f.realm.RTCPeerConnection;
  assert.notEqual(Object.getPrototypeOf(wrapper),wrapper);
  const native=Object.getPrototypeOf(wrapper);
  assert.throws(()=>Object.setPrototypeOf(wrapper,wrapper),error=>error instanceof TypeError&&/cyclic|cycle/i.test(error.message));
  assert.equal(Object.getPrototypeOf(wrapper),native);assert.equal(typeof wrapper.name,'string');assert.equal(typeof wrapper.length,'number');assert.equal(typeof wrapper.call,'function');
  assert.equal(Reflect.setPrototypeOf(wrapper,Object.prototype),true);assert.equal(Object.getPrototypeOf(wrapper),Object.prototype);assert.equal(Reflect.setPrototypeOf(wrapper,native),true);
  assert.ok(new wrapper() instanceof wrapper);
});
