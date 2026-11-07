// E22-21 / ADR-067: Firefox's native frame IDs can exceed the 32-bit counter bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import { patchUiFrameIds, UI_FRAME_ID_BUNDLES } from '../production/sync-ui-frame-ids.mjs';

const root = resolve(import.meta.dirname, '../..');
const prefixes = ['', 'baseline-ts/'];
const request = (frameId, tabId = 17) => ({ schemaVersion: 1, type: 'ui-get-report', tabId, frameId });
const validators = await Promise.all(prefixes.map(async prefix => {
  const compiled = await build({ entryPoints: [resolve(root, prefix + 'packages/contracts/src/validate.ts')], write: false, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, URL, DOMException }, { timeout: 1000 });
  const ajv = new Ajv2020({ strict: true });
  ajv.addSchema(JSON.parse(readFileSync(resolve(root, prefix + 'packages/contracts/schemas/common.v1.schema.json'), 'utf8')));
  const schema = JSON.parse(readFileSync(resolve(root, prefix + 'packages/contracts/schemas/ui-request.v1.schema.json'), 'utf8'));
  return { label: prefix || 'root/', validate: module.exports.validateUiRequest, schema: ajv.compile(schema), definition: schema };
}));

for (const { label, validate, schema, definition } of validators) {
  test('E22-21: ' + label + ' native Firefox frame IDs preserve exact identity through MAX_SAFE_INTEGER', () => {
    for (const frameId of [0, -0, 2147483647, 2147483648, 12884901889, Number.MAX_SAFE_INTEGER]) {
      const input = request(frameId), result = validate(input);
      assert.equal(result.ok, true, String(frameId)); assert.equal(schema(input), true, String(frameId));
      assert.equal(result.value.frameId, frameId === 0 ? 0 : frameId);
      assert.equal(result.value.tabId, 17); assert.notEqual(result.value, input);
    }
  });
  test('E22-21: ' + label + ' malformed, nonfinite, fractional and unsafe frame IDs remain rejected', () => {
    for (const frameId of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 1e100, '12884901889', null, undefined, {}, []]) {
      const input = request(frameId);
      assert.equal(validate(input).ok, false, String(frameId));
      // undefined is not JSON data; Ajv treats an optional undefined field as absent.
      if (frameId !== undefined) assert.equal(schema(input), false, String(frameId));
    }
  });
  test('E22-21: ' + label + ' tab IDs and unrelated counter bounds remain 32-bit', () => {
    assert.equal(validate(request(12884901889, 2147483647)).ok, true);
    assert.equal(schema(request(12884901889, 2147483647)), true);
    for (const tabId of [2147483648, 12884901889, Number.MAX_SAFE_INTEGER]) {
      assert.equal(validate(request(0, tabId)).ok, false); assert.equal(schema(request(0, tabId)), false);
    }
    assert.equal(validate({ schemaVersion: 1, type: 'ui-pause', tabId: 17, documentKey: '17:0:a', reportRevision: 2147483648 }).ok, false);
    const get = definition.oneOf.find(entry => entry.properties?.type?.const === 'ui-get-report');
    assert.deepEqual(get.properties.frameId, { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    assert.equal(get.properties.tabId.$ref.endsWith('/nonNegInt'), true);
  });
  test('E22-21: ' + label + ' existing never-throw/getter and no-coercion boundaries remain intact', () => {
    let getterCalls = 0, coercions = 0;
    const getter = request(0);
    Object.defineProperty(getter, 'frameId', { enumerable: true, get() { getterCalls++; throw new Error('private getter sentinel'); } });
    assert.equal(validate(getter).ok, false); assert.equal(getterCalls, 1);
    assert.equal(validate(request({ valueOf() { coercions++; return 12884901889; } })).ok, false); assert.equal(coercions, 0);
    const hostile = new Proxy({}, { get() { throw new Error('hostile read'); }, ownKeys() { throw new Error('hostile keys'); } });
    assert.equal(validate(hostile).ok, false);
    assert.equal(validate({ ...request(12884901889), newCommand: true }).ok, false);
    assert.equal(validate({ ...request(12884901889), type: 'page-get-report' }).ok, false);
  });
}

test('E22-21: shipped ordinary validator synchronization is idempotent and confined to the existing frame bound', () => {
  for (const name of UI_FRAME_ID_BUNDLES) {
    const source = readFileSync(resolve(root, 'apps/production-extension', name), 'utf8');
    assert.equal(patchUiFrameIds(source, name), source);
    const old = source.replace('let frameId = readInt(input.frameId, 0, Number.MAX_SAFE_INTEGER);', 'let frameId = readInt(input.frameId, 0, 2147483647);');
    assert.notEqual(old, source); assert.equal(patchUiFrameIds(old, name), source);
    assert.ok(source.includes('return readInt(v, 0, 2147483647);'), name + ' tabId still uses MAX_COUNT');
  }
  const checked = spawnSync(process.execPath, [resolve(root, 'scripts/production/sync-ui-frame-ids.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test('E22-21: scoped generator refuses missing, duplicated or unexpected validator boundaries', () => {
  const source = readFileSync(resolve(root, 'apps/production-extension/background.js'), 'utf8');
  assert.throws(() => patchUiFrameIds(source.replace('case "ui-get-report":', 'case "changed":')));
  assert.throws(() => patchUiFrameIds(source + '\n    case "ui-get-report": {'));
  assert.throws(() => patchUiFrameIds(source.replace('let frameId = readInt(input.frameId, 0, Number.MAX_SAFE_INTEGER);', 'let frameId = customReader(input.frameId);')));
});
