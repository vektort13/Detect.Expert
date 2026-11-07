// ADR-080: offline, exact-identity catalogue icons; no remote resources or detector logic.
import assert from'node:assert/strict';
import{readFileSync,writeFileSync}from'node:fs';
import{resolve}from'node:path';
import{createHash}from'node:crypto';
import{pathToFileURL}from'node:url';
import{AUTOSURF_SITES_DATA}from'../apps/production-extension/autosurf-sites-data.js';
const root=resolve(import.meta.dirname,'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateSystemIcons(input){
 assert.equal(input.version,1);assert.equal(input.accessedAt,'2026-10-30');assert.ok(Array.isArray(input.records)&&Array.isArray(input.assets));
 assert.equal(input.records.length,AUTOSURF_SITES_DATA.trackingSystems.length);assert.equal(input.assets.length,input.records.length);
 const names=new Map(),ids=new Set(),systems=new Map(AUTOSURF_SITES_DATA.trackingSystems.map(row=>[row.id,row]));
 const receipts=new Map(input.assets.map(row=>[row.id,row]));assert.equal(receipts.size,input.assets.length);
 let uniqueBytes=0;const files=new Set();
 for(const row of input.records){
  assert.ok(row&&Object.getPrototypeOf(row)===Object.prototype);assert.ok(Object.keys(row).every(key=>['id','name','asset','kind','brandId','aliases'].includes(key)));
  assert.ok(systems.has(row.id)&&!ids.has(row.id));ids.add(row.id);assert.equal(row.name,systems.get(row.id).name);
  assert.match(row.asset,/^(?:brands|systems)\/[a-z0-9][a-z0-9.-]*\.(?:svg|png|ico|jpg|jpeg|webp|gif)$/);assert.ok(!row.asset.includes('..'));
  assert.ok(['brand','generic'].includes(row.kind));if(row.kind==='generic')assert.equal(row.brandId,undefined);
  if(row.brandId!==undefined)assert.match(row.brandId,/^[a-z0-9][a-z0-9-]{0,79}$/);
  if(row.aliases!==undefined)assert.ok(Array.isArray(row.aliases)&&row.aliases.length<=16);
  for(const value of[row.id,row.name,...row.aliases??[]]){assert.ok(typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value));const key=value.trim().toLowerCase();assert.ok(!names.has(key)||names.get(key)===row.id,'Ambiguous icon alias');names.set(key,row.id);}
  const receipt=receipts.get(row.id);assert.ok(receipt);assert.equal(receipt.asset,row.asset);assert.equal(receipt.kind,row.kind);assert.equal(receipt.name,row.name);
  const bytes=readFileSync(resolve(root,'apps/production-extension/icons',row.asset));assert.ok(bytes.length>16&&bytes.length<=384*1024);assert.equal(bytes.length,receipt.bytes);assert.equal(hash(bytes),receipt.sha256);
  if(!files.has(row.asset)){files.add(row.asset);uniqueBytes+=bytes.length;}
  assert.ok(typeof receipt.license==='string'&&receipt.license.length>3);
  if(row.kind==='brand'){assert.equal(new URL(receipt.sourceUrl).protocol,'https:');if(receipt.officialWebsite)assert.ok(['https:','http:'].includes(new URL(receipt.officialWebsite).protocol));if(receipt.identitySourceUrl)assert.equal(new URL(receipt.identitySourceUrl).protocol,'https:');}
  else assert.equal(receipt.sourceUrl,undefined);
  if(row.asset.startsWith('systems/')){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),96);assert.equal(bytes.readUInt32BE(20),96);}
 }
 assert.ok(uniqueBytes<=8*1024*1024,'Decorative catalogue artwork budget');
 return{systems:input.records.length,brand:input.records.filter(row=>row.kind==='brand').length,generic:input.records.filter(row=>row.kind==='generic').length,uniqueFiles:files.size,uniqueBytes};
}
export function buildSystemIcons(check=false){
 const input=JSON.parse(readFileSync(resolve(root,'packages/catalog/data/system-icons.v1.json'),'utf8'));const summary=validateSystemIcons(input);
 const source='// ADR-080: packaged decorative system marks; identities are exact and never detector evidence.\nexport const SYSTEM_BRANDS = Object.freeze('+JSON.stringify(input.records)+'.map(mark => Object.freeze({ ...mark, ...(mark.aliases ? { aliases: Object.freeze([...mark.aliases]) } : {}) })));\n';
 const provenance=JSON.stringify({version:1,accessedAt:input.accessedAt,...summary,assets:input.assets},null,2)+'\n';
 for(const[file,contents]of[['apps/production-extension/system-branding-data.js',source],['apps/production-extension/icons/systems/PROVENANCE.json',provenance]]){
  const path=resolve(root,file);if(check)assert.equal(readFileSync(path,'utf8'),contents,'System icon source drift: '+file);else writeFileSync(path,contents);
 }
 return{...summary,moduleSha256:hash(Buffer.from(source))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify({result:'PASS',mode:process.argv.includes('--check')?'check':'build',...buildSystemIcons(process.argv.includes('--check'))}));
