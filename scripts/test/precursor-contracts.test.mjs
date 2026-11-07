import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRECURSOR_RULE_IDS, readPrecursorRequest, readPrecursorSnapshot } from '../../packages/contracts/src/precursor.mjs';

const request = { schemaVersion: 1, type: 'ui-get-precursor', tabId: 7, frameId: 3, documentKey: '7:3:native-doc' };
const empty = () => ({ schemaVersion: 1, type: 'precursor-state', documentKey: request.documentKey, coverageState: 'active', presence: 'not-observed', mode: 'unknown', lastObservedAt: null,
  ruleIds: [], evidenceSource: null, integrity: null, capabilities: { presenceDetection: true, modeDetection: false }, truncated: false });
const observed = () => ({ ...empty(), presence: 'observed', lastObservedAt: 1700000000000, ruleIds: [PRECURSOR_RULE_IDS[0]], evidenceSource: 'browser-network', integrity: 'browser-observed' });
test('Precursor read-only request validates native tab/frame/document identity exactly', () => {
  assert.deepEqual(readPrecursorRequest(request), request);
  for (const change of [{ schemaVersion: 2 }, { type: 'ui-set-precursor' }, { tabId: 8 }, { frameId: 0 }, { tabId: -1 }, { frameId: 1.5 },
    { documentKey: '07:3:native-doc' }, { documentKey: '7:03:native-doc' }, { documentKey: '9007199254740992:3:doc' }, { documentKey: '7:3:bad:id' }, { documentKey: '7:3:' + 'x'.repeat(65) }, { mode: 'armed' }]) {
    assert.equal(readPrecursorRequest({ ...request, ...change }), null);
  }
  assert.equal(readPrecursorRequest(Object.create(request)), null);
  assert.equal(readPrecursorRequest({ ...request, [Symbol('extra')]: true }), null);
});
test('all valid snapshots preserve unknown mode and explicit capability limits', () => {
  for (const value of [empty(), observed(), { ...empty(), coverageState: 'no-access', capabilities: { presenceDetection: false, modeDetection: false } }]) {
    assert.deepEqual(readPrecursorSnapshot(value), value);
  }
  for (const mode of ['off', 'monitor', 'armed', null, false]) assert.equal(readPrecursorSnapshot({ ...empty(), mode }), null);
  assert.equal(readPrecursorSnapshot({ ...observed(), capabilities: { presenceDetection: true, modeDetection: true } }), null);
  assert.equal(readPrecursorSnapshot({ ...observed(), capabilities: { presenceDetection: false, modeDetection: false } }), null);
});
test('absent observations cannot smuggle old evidence or claim Off', () => {
  for (const change of [{ lastObservedAt: 1 }, { ruleIds: [PRECURSOR_RULE_IDS[0]] }, { evidenceSource: 'browser-network' }, { integrity: 'browser-observed' },
    { presence: 'off' }, { modeChanged: true }, { url: 'https://secret.example/?TOKEN' }, { responseHeaders: [] }, { cookie: 'CANARY' }]) assert.equal(readPrecursorSnapshot({ ...empty(), ...change }), null);
  for (const state of ['paused', 'unsupported', 'no-access']) {
    assert.equal(readPrecursorSnapshot({ ...observed(), coverageState: state }), null);
    assert.equal(readPrecursorSnapshot({ ...empty(), coverageState: state }), null);
  }
  for (const change of [{ lastObservedAt: -1 }, { lastObservedAt: NaN }, { lastObservedAt: Infinity }, { ruleIds: [] }, { ruleIds: ['arbitrary-rule'] },
    { ruleIds: ['precursor-loader-candidate-v1'] }, { ruleIds: ['precursor-versioned-loader-candidate-v1'] },
    { ruleIds: [PRECURSOR_RULE_IDS[0], PRECURSOR_RULE_IDS[0]] }, { evidenceSource: 'page-dom' }, { integrity: 'page-controlled' }]) assert.equal(readPrecursorSnapshot({ ...observed(), ...change }), null);
});
test('request, nested capability and rule array accessors never execute', () => {
  let reads = 0;
  for (const [reader, value, field] of [[readPrecursorRequest, request, 'documentKey'], [readPrecursorSnapshot, observed(), 'mode']]) {
    const hostile = { ...value }; Object.defineProperty(hostile, field, { enumerable: true, get() { ++reads; throw Error('getter'); } });
    assert.equal(reader(hostile), null);
  }
  const caps = { modeDetection: false }; Object.defineProperty(caps, 'presenceDetection', { enumerable: true, get() { ++reads; return true; } });
  assert.equal(readPrecursorSnapshot({ ...empty(), capabilities: caps }), null);
  const rules = [PRECURSOR_RULE_IDS[0]]; Object.defineProperty(rules, '0', { enumerable: true, get() { ++reads; return PRECURSOR_RULE_IDS[0]; } });
  assert.equal(readPrecursorSnapshot({ ...observed(), ruleIds: rules }), null);
  assert.equal(readPrecursorSnapshot({ ...observed(), ruleIds: new Array(1) }), null);
  assert.equal(reads, 0);
});
test('reader produces an independent bounded projection and runtime contract matches canonical source', () => {
  const value = observed(), result = readPrecursorSnapshot(value);
  value.ruleIds.push(PRECURSOR_RULE_IDS[0]); value.capabilities.presenceDetection = false;
  assert.deepEqual(result.ruleIds, [PRECURSOR_RULE_IDS[0]]); assert.equal(result.capabilities.presenceDetection, true);
  assert.equal(readFileSync(new URL('../../packages/contracts/src/precursor.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../apps/production-extension/precursor-contracts.js', import.meta.url), 'utf8'));
});
