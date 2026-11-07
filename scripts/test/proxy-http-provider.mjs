// Explicit supplied HTTP CONNECT control; credentials are read from a private file.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
const root=resolve(import.meta.dirname,'../..');
const serverIndex=process.argv.indexOf('--server'),credentialIndex=process.argv.indexOf('--credentials');
const server=new URL(process.argv[serverIndex+1]);if(serverIndex<0||credentialIndex<0||server.protocol!=='http:'||server.username||server.password||!server.port)throw Error('invalid test arguments');
let credentials;try{credentials=JSON.parse(readFileSync(resolve(process.argv[credentialIndex+1]),'utf8'));}catch{throw Error('invalid private credential file');}
const result={at:new Date().toISOString(),result:'RUNNING',explicitUserProvider:true,protocol:'http-connect',credentialsInReport:false,destinationDomainPassedToProxy:true};let socket,phase='connect';
try{
 socket=net.connect({host:server.hostname,port:Number(server.port)});socket.setTimeout(15000,()=>socket.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));await once(socket,'connect');
 phase='proxy-auth';const authorization=Buffer.from(credentials.username+':'+credentials.password).toString('base64');credentials=null;
 const response=new Promise((resolve,reject)=>{let buffer=Buffer.alloc(0);const collect=data=>{buffer=Buffer.concat([buffer,data]);if(buffer.length>8192){socket.destroy();reject(Error('oversized proxy header'));return;}const end=buffer.indexOf('\r\n\r\n');if(end>=0){socket.removeListener('data',collect);resolve(buffer.subarray(0,end).toString());}};socket.on('data',collect);socket.once('error',reject);});
 socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic '+authorization+'\r\n\r\n');
 const header=await response;result.proxyStatus=Number(header.match(/^HTTP\/1\.[01] (\d{3}) /)?.[1]);if(result.proxyStatus!==200)throw Object.assign(Error('proxy refused'),{code:result.proxyStatus===407?'auth-failed':'proxy-error'});
 phase='tls';const secure=tls.connect({socket,servername:'example.com',rejectUnauthorized:true});await once(secure,'secureConnect');phase='http';secure.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');let text='';for await(const data of secure){text+=data;if(text.length>131072){secure.destroy();throw Error('oversized response');}}
 result.httpStatus=Number(text.match(/^HTTP\/1\.[01] (\d{3}) /)?.[1]);result.tlsVerified=true;result.result=result.httpStatus===200?'PASS':'PARTIAL';
}catch(error){result.result='FAIL';result.diagnostic={phase,code:typeof error.code==='string'&&/^[A-Z_a-z0-9-]{1,64}$/.test(error.code)?error.code:'request-failed'};}
finally{socket?.destroy();credentials=null;}
const directory=join(root,'test-results/production-1.1.0/proxy');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'http-provider.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.result!=='PASS')process.exitCode=1;
