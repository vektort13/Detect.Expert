// The exact dependency pin must not erase an IIFE opener or exempt application sinks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const temp = resolve(root, '.tmp');
const marker = '// packages/ui/src/view-models/message.ts';
const relativeFile = 'apps/production-extension/firewall-overlay.js';
const module = '// ../../node_modules/.pnpm/preact@10.29.8/node_modules/preact/dist/preact.module.js';
const htmlProperty = 'inner' + 'HTML';
const hash = source => createHash('sha256').update(source).digest('hex');
function fixture({ esm = false, mutatePrefix = false, appSink = false } = {}) {
  mkdirSync(temp, { recursive: true });
  const directory = mkdtempSync(join(temp, 'lint-preact-test-'));
  try {
    for (const path of ['apps/production-extension', 'packages', 'scripts/production']) mkdirSync(join(directory, path), { recursive: true });
    for (const file of ['lint.mjs', 'code-checks.mjs']) cpSync(join(root, 'scripts', file), join(directory, 'scripts', file));
    const prefix = (esm ? '' : '"use strict";\n(() => {\n') + module + '\nfunction inherited(node, html) { node.' + htmlProperty + ' = html; }\n';
    const application = marker + '\n' + (appSink ? 'target.' + htmlProperty + ' = untrusted;\n' : 'const safeApplication = true;\n') + (esm ? '' : '})();\n');
    writeFileSync(join(directory, relativeFile), prefix + (mutatePrefix ? '// dependency drift\n' : '') + application);
    writeFileSync(join(directory, 'scripts/production/lint-inventory.json'), JSON.stringify({ preact: { [relativeFile]: hash(prefix) }, urls: {} }));
    const result = spawnSync(process.execPath, [join(directory, 'scripts/lint.mjs')], { cwd: directory, encoding: 'utf8', timeout: 20_000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    assert.equal(dirname(resolve(directory)), temp);
    assert.ok(basename(directory).startsWith('lint-preact-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a correctly pinned inherited prefix keeps both IIFE and ESM application syntax valid', () => {
  for (const esm of [false, true]) { const result = fixture({ esm }); assert.equal(result.status, 0, result.output); assert.match(result.output, /lint: OK/); }
});
test('any dependency-prefix byte change fails closed instead of authorizing an unreviewed mask', () => {
  const result = fixture({ mutatePrefix: true });
  assert.equal(result.status, 1); assert.match(result.output, /inherited Preact prefix changed/); assert.match(result.output, /html-injection/);
});
test('application HTML sinks after the marker remain forbidden with a valid dependency pin', () => {
  for (const esm of [false, true]) { const result = fixture({ esm, appSink: true }); assert.equal(result.status, 1); assert.match(result.output, /html-injection/); assert.doesNotMatch(result.output, /source scan failed|inherited Preact prefix changed/); }
});
test('the shipped inline bundle pin covers only Preact modules before its first application module', () => {
  const source = readFileSync(join(root, relativeFile), 'utf8');
  const end = source.indexOf(marker); assert.ok(end > 0);
  const prefix = source.slice(0, end), inventory = JSON.parse(readFileSync(join(root, 'scripts/production/lint-inventory.json'), 'utf8'));
  assert.equal(hash(prefix), inventory.preact[relativeFile]);
  const modules = [...prefix.matchAll(/^\s*\/\/ (\S+)$/gm)].map(match => match[1]);
  assert.ok(modules.length > 0); assert.ok(modules.every(name => name.startsWith('../../node_modules/.pnpm/preact@10.29.8/node_modules/preact/')));
});
