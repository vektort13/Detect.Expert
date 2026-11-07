// ADR-109: the geolocation client is the only geolocation file allowed to reach the network, and only while its reviewed bytes are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reviewedCodeReferences, scanCode } from '../code-checks.mjs';

const root = join(import.meta.dirname, '../..');
const client = 'apps/production-extension/proxy-geo-client.js';

test('ADR-109 permits only the hash-reviewed fetch reference in the exact client file', () => {
  const source = 'const apiFetch = globalThis.fetch;', references = ['network-reference: fetch'];
  const review = { [client]: { references, sha256: createHash('sha256').update(source).digest('hex') } };
  assert.deepEqual(reviewedCodeReferences(source, client, scanCode(source, client), review), []);
  const changed = source + '\nfetch(url);';
  const result = reviewedCodeReferences(changed, client, scanCode(changed, client), review);
  assert.ok(result.includes('reviewed geolocation client source changed; independent review required'));
  assert.ok(result.includes('network-reference: fetch'));
  const other = 'apps/production-extension/proxy-geo-controller.js';
  assert.ok(reviewedCodeReferences(source, other, scanCode(source, other), { [other]: review[client] }).includes('invalid reviewed code-reference exception'));
  assert.ok(reviewedCodeReferences(source, client, scanCode(source, client), { [client]: { ...review[client], references: ['network-reference: WebSocket'] } }).includes('invalid reviewed code-reference exception'));
});

test('the repository inventory pins the real client bytes and no other geolocation file has a network reference', () => {
  const inventory = JSON.parse(readFileSync(join(root, 'scripts/production/lint-inventory.json'), 'utf8'));
  const source = readFileSync(join(root, client), 'utf8');
  assert.deepEqual(inventory.codeReferences[client].references, ['network-reference: fetch']);
  assert.equal(inventory.codeReferences[client].sha256, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(reviewedCodeReferences(source, client, scanCode(source, client), inventory.codeReferences), []);
  const dir = join(root, 'apps/production-extension');
  for (const name of readdirSync(dir).filter(file => /^proxy-geo-.*\.js$/.test(file) && file !== 'proxy-geo-client.js')) {
    const text = readFileSync(join(dir, name), 'utf8');
    assert.deepEqual(scanCode(text, 'apps/production-extension/' + name).filter(hit => hit.startsWith('network-reference') || hit.startsWith('dom-network')), [], name + ' must not reach the network');
  }
});
