// E22-25: explicit provider test input comes from stdin, never from this source.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, linkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';

const root=resolve(import.meta.dirname,'../..');
let raw='';for await(const data of process.stdin){raw+=data;if(Buffer.byteLength(raw)>512*1024)throw Error('input too large');}
let input;try { input=JSON.parse(raw.replace(/^\uFEFF/,'')); } catch { throw Error('invalid private test input'); } finally { raw=''; }
assert.ok(Array.isArray(input.profiles)&&input.profiles.length<=3);
const run=mkdtempSync(join(root,'.tmp/proxy-provider-')),base=join(run,'host');mkdirSync(join(base,'engines'),{recursive:true});
const release=join(root,'release/proxy-native/windows-amd64');
copyFileSync(join(release,'detect-expert-proxy.exe'),join(base,'detect-expert-proxy.exe'));
for(const file of ['xray.exe','openvpn2socks.exe'])linkSync(join(release,'engines',file),join(base,'engines',file));
const caller='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';writeFileSync(join(base,'allowed-callers.json'),JSON.stringify([caller]));
const child=spawn(join(base,'detect-expert-proxy.exe'),[caller],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,APPDATA:join(run,'data')}});
let pending=Buffer.alloc(0),sequence=0;const jobs=new Map();
child.stderr.resume();child.stdout.on('data',data=>{pending=Buffer.concat([pending,data]);while(pending.length>=4){const size=pending.readUInt32LE();assert.ok(size>0&&size<=524288);if(pending.length<4+size)return;const message=JSON.parse(pending.subarray(4,4+size));pending=pending.subarray(4+size);const job=jobs.get(message.id);if(job){jobs.delete(message.id);clearTimeout(job.timer);job.resolve(message);}}});
child.on('exit',()=>{for(const job of jobs.values()){clearTimeout(job.timer);job.reject(Error('native host exited'));}jobs.clear();});
function command(op,payload={}){const id='provider-'+(++sequence),body=Buffer.from(JSON.stringify({v:1,id,op,...payload})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{jobs.delete(id);reject(Error('native-timeout'));},65000);jobs.set(id,{resolve,reject,timer});child.stdin.write(Buffer.concat([header,body]));});}
function reader(socket){let buffer=Buffer.alloc(0),waiters=[],closed=false;const pump=()=>{while(waiters.length&&buffer.length>=waiters[0].size){const w=waiters.shift(),v=buffer.subarray(0,w.size);buffer=buffer.subarray(w.size);w.resolve(v);}if(closed)for(const w of waiters.splice(0))w.reject(Error('socket closed'));};socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);pump();});socket.on('end',()=>{closed=true;pump();});socket.on('error',()=>{closed=true;pump();});return{take(size){return new Promise((resolve,reject)=>{waiters.push({size,resolve,reject});pump();});},detach(){assert.equal(buffer.length,0);socket.removeAllListeners('data');}};}
async function viaProxy(port,hostname,path='/'){
 let phase='local-socket';try {
 const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(15000,()=>socket.destroy(Error('timeout')));await once(socket,'connect');const read=reader(socket);socket.write(Buffer.from([5,1,0]));assert.deepEqual([...await read.take(2)],[5,0]);
 const host=Buffer.from(hostname),request=Buffer.concat([Buffer.from([5,1,0,3,host.length]),host,Buffer.from([1,187])]);socket.write(request);const head=await read.take(4);if(head[1]!==0){socket.destroy();throw Object.assign(Error('SOCKS destination failure'),{code:head[1]===4?'dns-failed':'proxy-error'});}const n=head[3]===1?4:head[3]===4?16:(await read.take(1))[0];await read.take(n+2);read.detach();
 phase='tls';const secure=tls.connect({socket,servername:hostname,rejectUnauthorized:true});secure.setTimeout(15000,()=>secure.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));await once(secure,'secureConnect');phase='http';secure.write('GET '+path+' HTTP/1.1\r\nHost: '+hostname+'\r\nConnection: close\r\n\r\n');let response='';for await(const chunk of secure){response+=chunk.toString();if(response.length>128*1024){secure.destroy();throw Error('response too large');}}
 const status=Number(response.match(/^HTTP\/1\.[01] (\d{3}) /)?.[1]);assert.ok(status>=200&&status<400);return{status,domainRequest:true,tlsVerified:true,responseSha256:createHash('sha256').update(response).digest('hex'),observedProxyIP:response.match(/"ip"\s*:\s*"([^"]+)"/)?.[1]??response.match(/(?:^|\n)ip=([^\r\n]+)/)?.[1]??null};
 } catch(error) { error.phase=phase;throw error; }
}
function providerDiagnostic(error){return{code:typeof error.code==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(error.code)?error.code:'request-failed',phase:error.phase??'destination'};}
function healthyProbe(value){return value?.reachable===true&&value.remoteDns===true&&value.tlsVerified===true&&value.httpStatus===200&&net.isIP(value.ip??'')>0;}
const evidence={at:new Date().toISOString(),result:'RUNNING',explicitUserProvider:true,disposableProfile:true,rawCredentialsInReport:false,systemTunOrRouteChanges:false,
 hashes:Object.fromEntries(['detect-expert-proxy.exe','engines/xray.exe','engines/openvpn2socks.exe'].map(file=>[file,createHash('sha256').update(readFileSync(join(base,file))).digest('hex')])),checks:[]};
try{
 const hello=await command('hello');assert.equal(hello.ok,true);evidence.capabilities=hello.result.capabilities;
 for(let i=0;i<input.profiles.length;i++){
  const supplied=input.profiles[i],profileId='provider-'+i,profile={...supplied};if(profile.type==='openvpn'&&typeof profile.configPath==='string'){profile.config=readFileSync(profile.configPath,'utf8');delete profile.configPath;}
  const result={protocol:profile.type,saved:false,connected:false,dnsRequestsUseDomainAtyp:true,diagnostic:null};evidence.checks.push(result);
  let saved=await command('save',{profileId,profile});if(!saved.ok){result.diagnostic=saved.error;continue;}result.saved=true;
  const exported=await command('export',{profileIds:[profileId]});const record=exported.ok&&exported.result?.profiles?.[0];result.exportedAllFields=record?.profileId===profileId&&Object.entries(profile).every(([key,value])=>record.profile?.[key]===value);if(record)record.profile=null;
  const connected=await command('connect',{profileId});if(!connected.ok){result.diagnostic=connected.error;await command('disconnect');continue;}result.connected=true;
  try{result.trace=await viaProxy(connected.result.port,'api.ipify.org','/?format=json');}catch(error){result.diagnostic=providerDiagnostic(error);}
  const analyzer=await command('diagnose',{url:'https://api.ipify.org/?format=json'});result.analyzer=analyzer.ok?analyzer.result:null;if(!analyzer.ok)result.diagnostic=analyzer.error;
  const checkedActive=await command('check',{profileId,url:'https://api.ipify.org/?format=json'});result.activeCheck=checkedActive.ok?checkedActive.result:null;if(!checkedActive.ok)result.diagnostic=checkedActive.error;
  if(profile.type==='openvpn'){const cloneId=profileId+'-duplicate';const cloned=await command('save',{profileId:cloneId,profile});assert.equal(cloned.ok,true);const blocked=await command('check',{profileId:cloneId,url:'https://api.ipify.org/?format=json'});result.parallelVpnGuard=!blocked.ok&&blocked.error?.code==='active-vpn'&&blocked.error?.phase==='tunnel'&&blocked.error?.retryable===false;await command('delete',{profileId:cloneId});}
  const status=await command('status');result.nativeState=status.result?.state;result.activeRouteUnchanged=status.result?.profileId===profileId&&status.result?.port===connected.result.port;const disconnect=await command('disconnect');assert.equal(disconnect.ok,true);
  // Explicit shutdown removes the local endpoint, without a DIRECT fallback.
  result.localEndpointClosed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:connected.result.port});s.on('error',()=>resolve(true));s.on('connect',()=>{s.destroy();resolve(false);});});
  const checkedInactive=await command('check',{profileId,url:'https://api.ipify.org/?format=json'});result.inactiveCheck=checkedInactive.ok?checkedInactive.result:null;if(!checkedInactive.ok)result.diagnostic=checkedInactive.error;const afterCheck=await command('status');result.checkLeavesDisconnected=afterCheck.result?.state==='off'&&afterCheck.result?.profileId===''&&afterCheck.result?.port===null;
 }
 evidence.result=evidence.checks.every(check=>check.saved&&check.exportedAllFields&&check.connected&&check.trace?.status===200&&check.trace?.tlsVerified&&net.isIP(check.trace?.observedProxyIP??'')>0&&healthyProbe(check.analyzer)&&healthyProbe(check.activeCheck)&&healthyProbe(check.inactiveCheck)&&check.activeRouteUnchanged&&check.checkLeavesDisconnected&&check.localEndpointClosed&&(check.protocol!=='openvpn'||check.parallelVpnGuard))?'PASS':'PARTIAL';
}finally{
 child.stdin.end();await Promise.race([once(child,'exit'),new Promise(done=>setTimeout(done,2000))]);if(child.exitCode===null)child.kill();
 const output=join(root,'test-results/production-1.1.0/proxy');mkdirSync(output,{recursive:true});writeFileSync(join(output,'provider-native.json'),JSON.stringify(evidence,null,2)+'\n');
 assert.ok(resolve(run).startsWith(resolve(root,'.tmp')+sep));
 rmSync(run,{recursive:true,force:true});
}
console.log(JSON.stringify(evidence,null,2));if(evidence.result!=='PASS')process.exitCode=1;
