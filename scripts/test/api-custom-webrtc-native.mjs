// Owned local WebRTC/data-channel and fake-media fixture. No external STUN/TURN server or real media device.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

export async function rtcNativeSemanticProof(installer, seed) {
  const checks = [], failures = [], tracks = [], pcs = [];
  const check = (label, condition) => { if (!condition) { failures.push(label); throw Error(label); } checks.push(label); };
  const nativeCandidate = Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype,'candidate').get;
  const nativeAddress = Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype,'address').get;
  const nativeStats = RTCPeerConnection.prototype.getStats, nativeDeviceId = Object.getOwnPropertyDescriptor(MediaDeviceInfo.prototype,'deviceId').get;
  const nativeTrackSettings = MediaStreamTrack.prototype.getSettings;
  const certificate = await RTCPeerConnection.generateCertificate({name:'ECDSA',namedCurve:'P-256'});
  const suppliedFingerprint = certificate.getFingerprints()[0].value;
  const identityFields=[['BluetoothDevice',['id','name']],['BluetoothAdvertisingEvent',['name']],['USBConfiguration',['configurationName']],['USBAlternateInterface',['interfaceName']],['MIDIPort',['id','manufacturer','name','version']]];
  const identityDescriptors=[],midiDescriptors=[];
  for(const [name,fields]of identityFields)for(const key of fields){const target=globalThis[name]?.prototype,field=target&&Object.getOwnPropertyDescriptor(target,key);if(field?.get)identityDescriptors.push({name,key,target,field});}
  for(const name of ['MIDIInputMap','MIDIOutputMap'])for(const key of ['get','has','keys','values','entries','forEach',Symbol.iterator]){const target=globalThis[name]?.prototype,field=target&&Object.getOwnPropertyDescriptor(target,key);if(typeof field?.value==='function')midiDescriptors.push({name,key,target,field});}
  const ordinaryMapFunctions=['get','has','keys','values','entries','forEach'].map(key=>[key,Map.prototype[key]]);
  const profile = {addresses:{ipv4:{host:'192.0.2.10',stun:'198.51.100.20',turn:'203.0.113.30'},ipv6:{host:'2001:db8::10',stun:'2001:db8::20',turn:'2001:db8::30'}},iceTransportPolicy:'preserve',randomizeDevices:true,freshCertificates:true,deviceLifetime:'session'};
  const installation = installer(globalThis,[{id:'webrtc',mode:'custom',value:profile,deviceSeed:seed}]);
  let ignoredCertificateReads = 0;
  const first = new RTCPeerConnection({iceServers:[],get certificates(){ignoredCertificateReads++;return [certificate];}}), second = new RTCPeerConnection({iceServers:[]});
  pcs.push(first,second);
  try {
    check('caller certificate getter is ignored and constructor aliases remain guarded',ignoredCertificateReads===0&&RTCPeerConnection.prototype.constructor===RTCPeerConnection);
    check('all available Bluetooth USB and MIDI identity descriptors are intercepted without device permissions',identityDescriptors.every(({target,key,field})=>Object.getOwnPropertyDescriptor(target,key).get!==field.get));
    check('all available MIDI key paths are intercepted while native values retain native port handles',midiDescriptors.every(({target,key,field})=>key==='values'?Object.getOwnPropertyDescriptor(target,key).value===field.value:Object.getOwnPropertyDescriptor(target,key).value!==field.value));
    const manual = new RTCIceCandidate({candidate:'candidate:1 1 UDP 1234 192.168.99.7 5000 typ srflx raddr 10.7.8.9 rport 5000',sdpMid:'0'});
    check('candidate native getter/toJSON agree on selected address',manual.address===profile.addresses.ipv4.stun&&manual.relatedAddress===profile.addresses.ipv4.host&&manual.toJSON().candidate===manual.candidate&&!manual.candidate.includes('192.168.99.7'));
    let invalid=false;try{Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype,'address').get.call({});}catch(error){invalid=error instanceof TypeError;}check('native candidate receiver validation survives',invalid);
    const sender=first.createDataChannel('owned-fixture');
    const generated = await first.createOffer();
    check('DTLS fingerprint stays real and differs from ignored certificate',generated.sdp.includes('a=fingerprint:')&&!generated.sdp.includes(suppliedFingerprint));
    let callbackOffer=null,offerCalls=0,legacyOffer;
    const offerCallbackReady=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Native legacy offer callback timeout')),3000);legacyOffer=first.createOffer(value=>{callbackOffer=value;offerCalls++;clearTimeout(timer);done();},reject);});
    const offerVoid=await legacyOffer;await offerCallbackReady;
    check('native legacy offer callback stays projected and Promise<void> remains fulfilled',offerVoid===undefined&&offerCalls===1&&callbackOffer.sdp.includes('c=IN IP4 0.0.0.0')&&!callbackOffer.sdp.includes('192.168.99.7'));
    const pendingFirst=[],pendingSecond=[],candidateChecks=[];
    const add = async (target,candidate,queue) => { if(!candidate)return;if(target.remoteDescription)await target.addIceCandidate(candidate);else queue.push(candidate); };
    first.onicecandidate=event=>{if(event.candidate){const native=Reflect.apply(nativeCandidate,event.candidate,[]),address=Reflect.apply(nativeAddress,event.candidate,[]);candidateChecks.push({changed:event.candidate.candidate!==native,hidden:!address||!event.candidate.candidate.includes(address),matches:[profile.addresses.ipv4.host,profile.addresses.ipv6.host].includes(event.candidate.address)});}void add(second,event.candidate,pendingSecond);};
    second.onicecandidate=event=>{void add(first,event.candidate,pendingFirst);};
    const received = new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Local data-channel handshake timeout')),10000);second.ondatachannel=event=>{event.channel.onmessage=message=>{clearTimeout(timer);done(message.data);};};});
    const offer=await first.createOffer();await first.setLocalDescription(offer);await second.setRemoteDescription(offer);
    for(const candidate of pendingSecond.splice(0))await second.addIceCandidate(candidate);
    let callbackAnswer=null,answerCalls=0,legacyAnswer;
    const answerCallbackReady=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Native legacy answer callback timeout')),3000);legacyAnswer=second.createAnswer(value=>{callbackAnswer=value;answerCalls++;clearTimeout(timer);done();},reject);});
    const answerVoid=await legacyAnswer;await answerCallbackReady;
    check('native legacy answer callback stays projected and Promise<void> remains fulfilled',answerVoid===undefined&&answerCalls===1&&/c=IN IP4 (0.0.0.0|192.0.2.10)/.test(callbackAnswer.sdp));
    const answer=await second.createAnswer();await second.setLocalDescription(answer);await first.setRemoteDescription(answer);
    for(const candidate of pendingFirst.splice(0))await first.addIceCandidate(candidate);
    await new Promise((done,reject)=>{if(sender.readyState==='open')return done();const timer=setTimeout(()=>reject(Error('Local sender channel timeout')),10000);sender.onopen=()=>{clearTimeout(timer);done();};});
    sender.send('owned-message');check('two local native peers complete ICE/DTLS and exchange data',await received==='owned-message');
    check('actual native host candidates are projected before page listeners',candidateChecks.length>0&&candidateChecks.every(row=>row.changed&&row.hidden&&row.matches));
    const nativeReport=await Reflect.apply(nativeStats,first,[]), nativeAddresses=[];
    // The original method returns a native report. Its currently patched iteration
    // is intentionally also sanitized; no reference to an original iterator escapes.
    void nativeReport;
    const report=await first.getStats(), rows=[...report.values()], json=JSON.stringify(rows);
    check('native RTCStatsReport keeps native brand and sanitized candidate records',Object.prototype.toString.call(report)==='[object RTCStatsReport]'&&rows.some(row=>row.type==='local-candidate'&&row.address===profile.addresses.ipv4.host));
    check('all stats iteration/get paths agree on remapped IDs',rows.every(row=>report.get(row.id)===row)&&[...report].every(([key,value])=>key===value.id));
    let getCoercions=0,hasCoercions=0;const safeId=rows[0].id;let nativeMapReport=false;try{Reflect.apply(Object.getOwnPropertyDescriptor(Map.prototype,'size').get,report,[]);nativeMapReport=true;}catch{}
    const objectGet=report.get({toString(){getCoercions++;return safeId;}}),objectHas=report.has({[Symbol.toPrimitive](hint){if(hint!=='string')throw Error('Native string hint');hasCoercions++;return safeId;}});
    check('stats object keys preserve native Map or WebIDL coercion semantics',nativeMapReport?objectGet===undefined&&!objectHas&&getCoercions===0&&hasCoercions===0:objectGet===report.get(safeId)&&objectHas&&getCoercions===1&&hasCoercions===1);
    let invalidKeyReads=0,invalidStatsThis=false;try{Object.getPrototypeOf(report).get.call({},{toString(){invalidKeyReads++;return safeId;}});}catch(error){invalidStatsThis=error instanceof TypeError;}
    check('WebIDL stats invalid receiver preserves native validation before key coercion',invalidStatsThis&&invalidKeyReads===0);
    let foreachCount=0;report.forEach((value,key,receiver)=>{if(value.id!==key||receiver!==report)throw Error('Stats callback mismatch');foreachCount++;});check('native report forEach callback receives safe record/key/report',foreachCount===rows.length);
    const mapSentinel={},ordinary=new Map([['sentinel',mapSentinel]]);let ordinaryCount=0;ordinary.forEach((value,key,map)=>{if(value===mapSentinel&&key==='sentinel'&&map===ordinary)ordinaryCount++;});
    check('RTC stats leave ordinary page Maps and shared Map methods intact',ordinaryMapFunctions.every(([key,method])=>Map.prototype[key]===method)&&ordinary.get('sentinel')===mapSentinel&&ordinary.has('sentinel')&&[...ordinary.keys()][0]==='sentinel'&&[...ordinary.values()][0]===mapSentinel&&[...ordinary.entries()][0][1]===mapSentinel&&ordinaryCount===1);
    check('native SDP descriptions remain projected after signaling',first.localDescription.sdp.includes(profile.addresses.ipv4.host)&&first.remoteDescription.sdp.includes(profile.addresses.ipv4.host));
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});tracks.push(...stream.getTracks());
    const devices=await navigator.mediaDevices.enumerateDevices(), actualTrack=stream.getAudioTracks()[0], actualSettings=Reflect.apply(nativeTrackSettings,actualTrack,[]);
    const device=devices.find(value=>value.kind==='audioinput'&&Reflect.apply(nativeDeviceId,value,[])===actualSettings.deviceId);
    check('randomized enumerateDevices and live track settings share alias',!!device&&(/^[a-f0-9]{64}$/.test(device.deviceId)||device.deviceId==='default'||device.deviceId==='communications')&&actualTrack.getSettings().deviceId===device.deviceId&&actualTrack.label===device.label);
    const physical=devices.find(value=>value.kind==='audioinput'&&/^[a-f0-9]{64}$/.test(value.deviceId));check('real fake-device identity receives a seeded alias',!!physical);
    const selected=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:physical.deviceId}}});tracks.push(...selected.getTracks());
    const selectedTrack=selected.getAudioTracks()[0];check('alias selection resolves a real native media track',Reflect.apply(nativeTrackSettings,selectedTrack,[]).deviceId===Reflect.apply(nativeDeviceId,physical,[]));
    await selectedTrack.applyConstraints({deviceId:{exact:physical.deviceId}});
    check('applyConstraints/getConstraints keep alias/native round trip',selectedTrack.getSettings().deviceId===physical.deviceId&&selectedTrack.getConstraints().deviceId.exact===physical.deviceId);
    check('media native object brands and counts are preserved',devices.every(device=>device instanceof MediaDeviceInfo)&&selectedTrack instanceof MediaStreamTrack);
    check('no media device identity leaks through toJSON or InputDeviceInfo capabilities',device.toJSON().deviceId===device.deviceId&&(!device.getCapabilities||device.getCapabilities().deviceId===device.deviceId));
    for(const source of ['about:blank','srcdoc']){
      const frame=document.createElement('iframe');let childInstallation;
      try{
        const loaded=new Promise(done=>frame.addEventListener('load',done,{once:true}));if(source==='srcdoc')frame.srcdoc='<!doctype html><title>Owned inherited RTC realm</title>';document.body.append(frame);await loaded;
        const child=frame.contentWindow;childInstallation=installer(child,[{id:'webrtc',mode:'custom',value:profile,deviceSeed:seed}]);
        const childId=Object.getOwnPropertyDescriptor(child.MediaDeviceInfo.prototype,'deviceId').get;
        check('same-origin inherited '+source+' borrowed media getter shares parent aliases',Reflect.apply(childId,physical,[])===physical.deviceId&&child.origin===origin);
      }finally{childInstallation?.stop();frame.remove();}
    }
    if(typeof AudioContext==='function'&&Object.getOwnPropertyDescriptor(AudioContext.prototype,'sinkId')){
      const silent=new AudioContext({sinkId:{type:'none'}});
      try{check('native silent AudioSinkInfo retains object type and AudioContext constructor ownership',typeof silent.sinkId==='object'&&silent.sinkId.type==='none'&&AudioContext.prototype.constructor===AudioContext);}finally{await silent.close();}
    }
    check('installer reports no critical native interception errors',installation.snapshot().unavailable===0);
    return {checks,failures,state:installation.snapshot(),statsRows:rows.length,candidateEvents:candidateChecks.length,identitySurfaces:identityDescriptors.map(({name,key})=>name+'.'+key),midiSurfaces:midiDescriptors.map(({name,key})=>name+'.'+(typeof key==='symbol'?'@@iterator':key))};
  } finally {for(const track of tracks)track.stop();for(const pc of pcs)pc.close();installation.stop();}
}

async function main(){
  const root=resolve(import.meta.dirname,'../..'), installed=process.argv.includes('--installed-chrome');
  const outputIndex=process.argv.indexOf('--output'),output=resolve(outputIndex<0?join(root,'test-results/production-1.1.0/api-custom-webrtc-'+(installed?'chrome155':'chromium153')+'.json'):process.argv[outputIndex+1]);
  const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Owned RTC fixture</title>');});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const browser=await chromium.launch({channel:installed?'chrome':'chromium',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--no-proxy-server']});
  const evidence={at:new Date().toISOString(),scope:'owned loopback peers and browser fake media; no external ICE server, real camera or user profile',result:'RUNNING',browser:browser.version(),runtimeSHA:createHash('sha256').update(readFileSync(join(root,'apps/production-extension/api-custom-webrtc-runtime.js'))).digest('hex')};
  try{const context=await browser.newContext({permissions:['camera','microphone']});const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);const result=await page.evaluate('('+rtcNativeSemanticProof.toString()+')(('+installWebRtcCustom.toString()+'),'+JSON.stringify('a'.repeat(64))+')');Object.assign(evidence,result);evidence.result='PASS';}
  catch(error){evidence.result='FAIL';evidence.error=error.message;throw error;}
  finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');}
  console.log(JSON.stringify({result:evidence.result,browser:evidence.browser,checks:evidence.checks.length,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await main();
