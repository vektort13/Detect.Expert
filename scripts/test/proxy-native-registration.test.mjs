// Native integration must never temporarily replace the user's installed host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { PROXY_NATIVE_HOST } from '../../apps/production-extension/proxy-shared.js';
import { createOwnedNativeHostName, ownedNativeHostPaths, ownedNativeBindingSource, isolateOwnedNativeBinding } from './proxy-native-host-fixture.mjs';

const hostName = 'com.detect_expert.proxy.audit_' + 'a'.repeat(32);
const source = "export const PROXY_NATIVE_HOST = 'com.detect_expert.proxy';\nconst other='com.detect_expert.proxy';\n";
test('owned native registrations use only a fresh audit namespace in each browser registry', () => {
  const names = Array.from({ length: 8 }, () => createOwnedNativeHostName()); assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^com\.detect_expert\.proxy\.audit_[a-f0-9]{32}$/);
    for (const browser of ['chrome', 'firefox']) for (const path of ownedNativeHostPaths(browser, name)) {
      assert.equal(path.endsWith('\\' + name), true); assert.equal(path.endsWith('\\' + PROXY_NATIVE_HOST), false);
      assert.equal(path.includes('..'), false);
    }
  }
});
test('the production host name and malformed or path-shaped names are rejected before any registry operation', () => {
  for (const name of [PROXY_NATIVE_HOST, 'com.detect_expert.proxy.audit_x', hostName + '\\foreign', hostName + "'", hostName + '\n', '../proxy', hostName.toUpperCase()]) {
    assert.throws(() => ownedNativeHostPaths('chrome', name)); assert.throws(() => ownedNativeBindingSource(source, name));
  }
  assert.throws(() => ownedNativeHostPaths('another-browser', hostName));
});
test('the instrumented binding changes one exact constant without modifying other native names or source code', () => {
  const patched = ownedNativeBindingSource(source, hostName);
  assert.equal(patched, source.replace("PROXY_NATIVE_HOST = 'com.detect_expert.proxy'", "PROXY_NATIVE_HOST = '" + hostName + "'"));
  assert.equal(patched.includes("const other='com.detect_expert.proxy';"), true);
  assert.throws(() => ownedNativeBindingSource(source + source, hostName));
  assert.throws(() => ownedNativeBindingSource('export const something = 1;', hostName));
  assert.equal(PROXY_NATIVE_HOST, 'com.detect_expert.proxy');
});
test('fixture attestation distinguishes the original delivered hash from the single-literal instrumented hash', () => {
  const directory = mkdtempSync(join(tmpdir(), 'detect-proxy-binding-test-'));
  try {
    const path = join(directory, 'proxy-shared.js'); writeFileSync(path, source);
    const result = isolateOwnedNativeBinding({ directory, hostName }), sha = value => createHash('sha256').update(value).digest('hex');
    assert.equal(result.productionName, PROXY_NATIVE_HOST); assert.equal(result.fixtureName, hostName);
    assert.equal(result.originalSHA256, sha(source)); assert.equal(result.instrumentedSHA256, sha(readFileSync(path)));
    assert.notEqual(result.instrumentedSHA256, result.originalSHA256); assert.equal(result.onlyNativeHostNameChanged, true);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true });
  }
});
