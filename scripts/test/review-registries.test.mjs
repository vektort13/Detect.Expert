import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
const read = name => readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
const literal = (source, begin, end) => { const start = source.indexOf(begin); assert.ok(start >= 0, begin); const finish = source.indexOf(end, start); assert.ok(finish > start, end); return JSON.parse(JSON.stringify(runInNewContext('(' + source.slice(start + begin.length, finish) + ')', {}, { timeout: 1000 }))); };
test('every shipped operation has a displayed mechanism and all execution worlds share its wire position', () => {
  let baseline;
  for (const file of ['hook.main.js', 'hook.early.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
    const source = read(file), definitions = literal(source, 'var API_OPERATION_DEFINITIONS = ', ', API_OPERATIONS =');
    const expected = 398 + WASM_SURFACES.length - 10;
    assert.equal(definitions.length, expected); assert.equal(new Set(definitions.map(row => row[0])).size, expected);
    if (source.includes('API_MECHANISMS = ')) {
      const mechanisms = literal(source, 'API_MECHANISMS = ', ', apply');
      for (const row of definitions) assert.ok(mechanisms.includes(row[2]), file + ': undisplayed ' + row[0]);
    } else assert.ok(!['popup.js', 'sidepanel.js', 'report.js'].includes(file));
    if (baseline) assert.deepEqual(definitions, baseline, file); else baseline = definitions;
  }
});
test('live API groups have translated titles for all added mechanisms without nonexistent explanatory keys', () => {
  const added = ['device-sensor', 'webtransport', 'webauthn', 'clipboard', 'worker', 'storage'];
  for (const file of ['popup.js', 'sidepanel.js', 'report.js']) {
    const source = read(file), titles = literal(source, 'TITLES = ', ', ICONS =');
    for (const mechanism of added) assert.equal(titles[mechanism], 'api_mechanism_' + mechanism.replaceAll('-', '_'));
    assert.ok(source.includes(JSON.stringify(added) + '.includes(mechanism) ? null :'));
  }
});
