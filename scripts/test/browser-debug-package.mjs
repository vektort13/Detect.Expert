// ADR-063: relate native evidence to the exact source, unpacked deliveries and deterministic release archives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { archiveProduction } from '../build-production.mjs';

const root = resolve(import.meta.dirname, '../..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { result: 'PASS', at: new Date().toISOString(), matches: [], archives: [] };
for (const browser of ['chrome', 'firefox']) {
  const evidence = JSON.parse(readFileSync(resolve(root, 'test-results/production-1.1.0/browser-debug', browser + '.json')));
  assert.equal(evidence.result, 'PASS', browser + ': native result');
  for (const [file, expected] of Object.entries(evidence.hashes)) {
    const actual = sha(readFileSync(resolve(root, 'dist', browser, file)));
    assert.equal(actual, expected, browser + ': native → dist ' + file); result.matches.push({ browser, file, sha256: actual });
    if (file.startsWith('browser-debug-')) assert.equal(sha(readFileSync(resolve(root, 'apps/production-extension', file))), actual, browser + ': source → dist ' + file);
  }
  const version = JSON.parse(readFileSync(resolve(root, 'dist', browser, 'manifest.json'), 'utf8')).version;
  const path = resolve(root, 'release/Detect.Expert-' + version + '-' + browser + '.zip'), archive = readFileSync(path);
  assert.equal(sha(archiveProduction(resolve(root, 'dist', browser))), sha(archive), browser + ': every archived byte equals final dist');
  result.archives.push({ browser, path, bytes: archive.length, sha256: sha(archive) });
}
writeFileSync(resolve(root, 'test-results/production-1.1.0/browser-debug/package.json'), JSON.stringify(result, null, 2) + '\n');
console.log('PASS Browser Debug package: ' + result.matches.length + ' native/dist hashes, both source copies and both complete deterministic ZIPs');
