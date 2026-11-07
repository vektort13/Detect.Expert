import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {reviewedDetectorImport} from '../lint.mjs';
import {scanCode} from '../code-checks.mjs';
const file='apps/production-extension/detector-ui.js';
const hits=(source,path=file)=>scanCode(reviewedDetectorImport(source,path),path);
test('only the reviewed single fixed local Inspector chunk is exempt from dynamic import denial',()=>{
 const source=readFileSync(new URL('../../apps/production-extension/detector-ui.js',import.meta.url),'utf8');
 assert.equal(source.split("import('./popup.js')").length,2);assert.deepEqual(hits(source),[]);
 assert.ok(hits("const load=()=>import('./popup.js');",'apps/production-extension/hook.main.js').includes('dynamic-import'));
});
test('remote, computed, alternate or duplicate imports remain denied in the reviewed UI file',()=>{
 for(const source of["const load=()=>import('https://invalid.example/module.js');","const load=value=>import(value);","const load=()=>import('./'+'popup.js');","const load=()=>import('./other.js');","const a=import('./popup.js'),b=import('./popup.js');","const a=import('./popup.js'),b=import('https://invalid.example/module.js');"])
  assert.ok(hits(source).includes('dynamic-import'),source);
});
test('the local import exception does not suppress unrelated executable sinks or network calls',()=>{
 const source="const load=()=>import('./popup.js'); eval('x'); new Function('x'); fetch('https://invalid.example/');";
 const actual=hits(source);assert.ok(actual.includes('eval-reference'));assert.ok(actual.includes('function-constructor-reference'));assert.ok(actual.includes('network-reference: fetch'));
});
