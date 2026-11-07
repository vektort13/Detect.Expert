import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reviewedCodeReferences,scanCode} from '../code-checks.mjs';
test('ADR-076 permits only hash-reviewed fetch capability in the exact API service file',()=>{
  const file='apps/production-extension/precursor-modes-service.js',source='const apiFetch = globalThis.fetch;',references=['network-reference: fetch'];
  const review={[file]:{references,sha256:createHash('sha256').update(source).digest('hex')}};
  assert.deepEqual(reviewedCodeReferences(source,file,scanCode(source,file),review),[]);
  assert.ok(reviewedCodeReferences(source+'\nfetch(url);',file,scanCode(source+'\nfetch(url);',file),review).includes('network-reference: fetch'));
  assert.ok(reviewedCodeReferences(source,'apps/production-extension/other.js',scanCode(source,file),{'apps/production-extension/other.js':review[file]}).includes('invalid reviewed code-reference exception'));
  assert.ok(reviewedCodeReferences(source,file,scanCode(source,file),{[file]:{...review[file],references:['network-reference: WebSocket']}}).includes('invalid reviewed code-reference exception'));
});
