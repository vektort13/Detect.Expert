// ADR-069: native normalization probes use disposable profiles and fixed fixture cookies only.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cookie-canonical-native-'));
const browsers = process.argv.includes('--firefox') ? ['firefox'] : process.argv.includes('--chrome') ? ['chrome'] : ['chrome', 'firefox'];
const copies = {};
const paths = ['/a b', '/a/../b', '/a%2e/b', '/a?b#c', '/a\\b', '/a%20b', '/кир', '/a/%2e%2e/b', '/a/%2E/b', '//x', '/a%2Fb', '/a%zzb', '/a[b]', '/a:b', '/a;b', "/a'b", '/a"b', '/a<b', '/a>b', '/a`b', '/a{b}', '/a|b', '/a^b', '/a%2520b', '/a%b'];
for (const browser of browsers) {
  const extension = join(run, browser + '-extension'); cpSync(join(root, 'dist', browser), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
  manifest.optional_permissions = manifest.optional_permissions.filter(permission => permission !== 'cookies');
  if (!manifest.permissions.includes('cookies')) manifest.permissions.push('cookies');
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(extension, 'cookie-canonical-native-bridge.js'), `const api=globalThis.browser??globalThis.chrome;
export async function probe(){
const results={paths:[],domains:[],origins:[],partitions:[],limits:[],values:[],secureTransitions:[]};let index=0;
for(const path of ${JSON.stringify(paths)}){
const name='owned_path_'+index++;let error=null;
try{await api.cookies.set({url:'https://owned-cookie.example.com/',name,value:'owned-fixture',path,secure:true,httpOnly:true,sameSite:'lax'})}catch{error='rejected'}
const found=await api.cookies.getAll({name,domain:'example.com',partitionKey:{}});results.paths.push({input:path,error,actual:found.map(c=>({path:c.path,domain:c.domain,hostOnly:c.hostOnly}))});}
for(const host of ['com','co.uk','localhost']){
const name='owned_domain_'+index++;let error=null;
try{await api.cookies.set({url:'https://'+host+'/',domain:'.'+host,name,value:'owned-fixture',path:'/',secure:true,httpOnly:true,sameSite:'lax'})}catch{error='rejected'}
const found=await api.cookies.getAll({name,partitionKey:{}});results.domains.push({input:'.'+host,error,actual:found.map(c=>({domain:c.domain,hostOnly:c.hostOnly}))});}
const host='owned-cookie.example.com';
for(const [label,first,second] of [['scheme','https://'+host+'/','http://'+host+'/'],['port','https://'+host+':8443/','https://'+host+'/']]){
const name='owned_origin_'+label;
for(const url of [first,second]){try{await api.cookies.set({url,name,value:'owned-fixture',path:'/',secure:false,httpOnly:true,sameSite:'lax'})}catch{}}
const all=await api.cookies.getAll({name,domain:'example.com',partitionKey:{}}),a=await api.cookies.getAll({name,url:first,partitionKey:{}}),b=await api.cookies.getAll({name,url:second,partitionKey:{}});
results.origins.push({label,count:all.length,firstCount:a.length,secondCount:b.length});}
for(const [topLevelSite,hasCrossSiteAncestor]of [['https://example.net',false],['https://example.com',false],['https://example.com',true],['https://example.net',true],['http://example.com',false]]){
const name='owned_partition_'+index++;let error=null;
try{await api.cookies.set({url:'https://'+host+'/',name,value:'owned-fixture',path:'/',secure:true,httpOnly:true,sameSite:'no_restriction',partitionKey:{topLevelSite,hasCrossSiteAncestor}})}catch{error='rejected'}
const found=await api.cookies.getAll({name,partitionKey:{}});results.partitions.push({topLevelSite,hasCrossSiteAncestor,error,actual:found.map(c=>({partitionKey:c.partitionKey}))});}
for(const [label,value,path]of [['pair4096','v'.repeat(4095),'/limit_pair4096'],['pair4097','v'.repeat(4096),'/limit_pair4097'],['pair4096utf8','é'.repeat(2047)+'x','/limit_pair_utf8'],['path1024','fixture','/'+('a'.repeat(1023))],['path1025','fixture','/'+('a'.repeat(1024))]]){
const name='k';let error=null;
try{await api.cookies.set({url:'https://'+host+'/',name,value,path,secure:true,httpOnly:true,sameSite:'lax'})}catch{error='rejected'}
const found=await api.cookies.getAll({name,path,domain:'example.com',partitionKey:{}});results.limits.push({label,pairBytes:new TextEncoder().encode(name+value).length,pathBytes:new TextEncoder().encode(path).length,error,count:found.length});}
for(const [label,name,value]of [['semicolon','owned_v_semicolon','a;b'],['leading-trailing-space','owned_v_space',' value '],['quote','owned_v_quote','a"b'],['backslash','owned_v_backslash','a\\\\b'],['unicode-name','é','fixture'],['both-empty','',''],['empty-name','','fixture']]){
const path='/value_'+label;let error=null;
try{await api.cookies.set({url:'https://'+host+'/',name,value,path,secure:true,httpOnly:true,sameSite:'lax'})}catch{error='rejected'}
const found=await api.cookies.getAll({name,path,domain:'example.com',partitionKey:{}});results.values.push({label,error,count:found.length,same:found.length===1&&found[0].value===value&&found[0].name===name});}
for(const scheme of ['http','https']){
const name='owned_secure_transition_'+scheme;let error=null;
await api.cookies.set({url:'https://'+host+'/',name,value:'owned-fixture',path:'/',secure:true,httpOnly:true,sameSite:'lax'});
try{await api.cookies.set({url:scheme+'://'+host+'/',name,value:'owned-fixture',path:'/',secure:false,httpOnly:true,sameSite:'lax'})}catch{error='rejected'}
const found=await api.cookies.getAll({name,domain:'example.com',partitionKey:{}});results.secureTransitions.push({scheme,error,count:found.length,actual:found.map(c=>({secure:c.secure}))});}
return results;}
`);
  copies[browser] = extension;
}
console.log('FROZEN ' + run);
for (const browser of browsers) {
  const directory = join(run, browser); mkdirSync(directory, { recursive: true });
  const evidence = { browser, disposableProfile: true, fixtureCookiesOnly: true, result: 'RUNNING' }; let opened;
  try {
    opened = await launchOwnedManagement({ root, run: directory, extension: copies[browser], browser, evidence });
    evidence.version = opened.version; await opened.goto(opened.base + 'options.html#cookies');
    evidence.observed = await opened.evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return (await import(api.runtime.getURL('cookie-canonical-native-bridge.js'))).probe(); });
    evidence.result = 'PASS';
  } catch (error) { evidence.result = 'FAIL'; evidence.error = error?.message ?? 'probe-failed'; process.exitCode = 1; }
  finally { if (opened) await opened.close(); }
  writeFileSync(join(run, browser + '.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
}
