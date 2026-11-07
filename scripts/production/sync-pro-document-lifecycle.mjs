// ADR-072 / PROD-01: source-preserving migration and drift gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchProDocumentLifecycle } from './pro-document-lifecycle.mjs';
const root=resolve(import.meta.dirname,'../..'),check=process.argv.includes('--check');
for(const name of ['background.js']){
 const path=resolve(root,'apps/production-extension',name),before=readFileSync(path,'utf8'),after=patchProDocumentLifecycle(before.replaceAll('\r\n','\n'),name);
 if(check&&after!==before.replaceAll('\r\n','\n'))throw Error(name+': document lifecycle synchronization required');
 if(!check&&after!==before)writeFileSync(path,after);
}
console.log((check?'checked':'synchronized')+' Pro exact-document invalidation');
