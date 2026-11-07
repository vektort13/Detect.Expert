// ADR-034 / REQ-010: exact identities and inert, attributed, packaged company artwork.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COMPANY_BRANDS, companyBrand } from '../../apps/production-extension/company-branding.js';
import { cookieCompanyMark } from '../../apps/production-extension/cookie-branding.js';
const root=new URL('../../',import.meta.url);
const directory=new URL('apps/production-extension/icons/brands/',root);
const provenance=JSON.parse(readFileSync(new URL('COMPANY-PROVENANCE.json',directory),'utf8'));
const source=JSON.parse(readFileSync(new URL('packages/catalog/research/company-logos-2026-10/registry.json',root),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('each shipped brand has a bounded local file with matching independently recorded source hash',()=>{
 const ids=new Set(),files=new Set(); const ledger=new Map(provenance.assets.map(a=>[a.id,a]));
 for(const brand of COMPANY_BRANDS){
  assert.match(brand.id,/^[a-z0-9][a-z0-9-]{0,79}$/); assert.equal(ids.has(brand.id),false,brand.id);ids.add(brand.id);
  assert.match(brand.file,/^[a-z0-9][a-z0-9-]{0,79}\.(?:svg|png|ico|jpg|jpeg|webp|gif)$/);assert.equal(files.has(brand.file),false,brand.file);files.add(brand.file);
  const item=ledger.get(brand.id); assert.ok(item,brand.id);assert.equal(item.file,brand.file);
  const bytes=readFileSync(new URL(brand.file,directory));assert.ok(bytes.length>16&&bytes.length<=384*1024,brand.file);assert.equal(bytes.length,item.bytes);assert.equal(digest(bytes),item.sha256,brand.file);
  assert.equal(new URL(item.sourceUrl).protocol,'https:');assert.ok(item.license&&item.license.length>3,brand.id);
  if(item.relationshipSource){assert.equal(new URL(item.relationshipSource).protocol,'https:');assert.ok(item.brandOwner);}
 }
 assert.deepEqual(source.brands.map(b=>b.id).sort(),[...ids].sort(),'Every reviewed registry identity is packaged');
 assert.deepEqual(provenance.failures,[],'Acquisition failures must be separated from the validated shipment');
 assert.deepEqual(source.unresolved,provenance.unresolved,'Unavailable genuine artwork remains explicit in both research ledgers');
 for(const item of source.unresolved){assert.equal(ids.has(item.id),false);assert.equal(item.status,'unresolved-artwork');assert.ok(item.reason);assert.ok(item.attemptedSources.length);for(const url of item.attemptedSources)assert.equal(new URL(url).protocol,'https:');for(const label of [...item.aliases,...item.declarantAliases])assert.equal(companyBrand(label),null);}
});
test('SVG assets are static paths with no script, imported resources, fonts, animation or externally resolved elements',()=>{
 for(const brand of COMPANY_BRANDS.filter(b=>b.file.endsWith('.svg'))){const svg=readFileSync(new URL(brand.file,directory),'utf8');
  assert.match(svg,/<svg\b/);assert.match(svg,/\bviewBox\s*=/);
  assert.doesNotMatch(svg,/<(?:script|style|image|foreignObject|use|animate[a-z]*|set|discard|iframe|object|embed|audio|video|text)\b|\b(?:href|src|on[a-z]+)\s*=|<!DOCTYPE|<!ENTITY|@import|url\s*\(/i,brand.file);
 }
});
test('all original Font Awesome assets and the original attribution manifest stay intact',()=>{
 const legacy=JSON.parse(readFileSync(new URL('PROVENANCE.json',directory),'utf8'));assert.equal(legacy.icons.length,18);assert.equal(legacy.commit,'af620534bfc3c2d4cbefcfeec29603bbe7809e64');
 for(const icon of legacy.icons){const bytes=readFileSync(new URL(icon.file,directory));assert.equal(bytes.length,icon.bytes);assert.equal(digest(bytes),icon.sha256);assert.equal(COMPANY_BRANDS.find(b=>b.id===icon.id)?.file,icon.file);}
});
test('exact static aliases are unambiguous and declaration authors keep their explicit role',()=>{
 const seen=new Map();let declarations=0;
 for(const brand of COMPANY_BRANDS)for(const [labels,role]of[[brand.aliases,'company'],[brand.declarantAliases,'declarant']])for(const label of labels){
  const key=label.trim().toLowerCase();assert.equal(seen.has(key),false,label);seen.set(key,brand.id);
  const resolved=companyBrand(' '+label.replace(/[a-z]/g,c=>c.toUpperCase())+' ');assert.ok(resolved,label);assert.equal(resolved.id,brand.id);assert.equal(resolved.role,role);assert.equal(resolved.brand,brand.id);assert.equal(resolved.src,new URL(brand.file,directory).href);
  if(role==='declarant'){declarations++;assert.equal(cookieCompanyMark(label).src,null,'A declaration author is not assigned as cookie manufacturer');}
 }
 assert.ok(declarations>500);
 for(const value of[null,{},7,'google.com','www.Google','Google Analytics evil','Vendor declaration: Google','x'.repeat(257),'Site application (session)','Site consent manager (consent)'])assert.equal(companyBrand(value),null,String(value));
 assert.equal(cookieCompanyMark('Google').brand,'google');assert.equal(cookieCompanyMark('Unknown Author').src,null);
});
