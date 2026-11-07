// ADR-058: page-hosted actions never widen persistent policy or select a native target.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
  export * from './apps/production-protect/src/overlay-actions.ts';
  export * from './vendor/protect-722fae8/packages/ui/test/protect-firewall-support.ts';
  export { validateProtectUiRequest, PROTECT_BUDGETS } from '@detect-expert/contracts';
` }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', tsconfig: resolve(root, 'apps/production-protect/tsconfig.json') });
const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const context = (report = M.fwProjection(), undoIds = []) => ({ tabId: 12, documentKey: M.FW_DOC_KEY, report, undoIds: new Set(undoIds) });
const body = (over = {}) => ({ documentKey: M.FW_DOC_KEY, protectRevision: 5, promptId: M.FW_PROMPT_ID, receivers: [M.FW_RECEIVER], action: 'block', scope: 'once', ...over });
const envelope = (action = 'decide', request = body(), over = {}) => ({ schemaVersion: 1, type: 'protect-overlay-action', kind: 'findings', generation: 1, documentKey: M.FW_DOC_KEY, action, request, ...over });
const check = (message = envelope(), ctx = context()) => M.authorizeOverlayAction(message, ctx);
const rejected = (result, code) => { assert.equal(result.type, 'reject'); if (code) assert.equal(result.code, code); };

test('once allow/block produces a fresh canonical request with only the native-bound tab', () => {
  for (const action of ['block', 'allow']) {
    const original = envelope('decide', body({ action }));
    const result = check(original); assert.equal(result.type, 'request');
    assert.deepEqual(result.request, { schemaVersion: 1, type: 'ui-protect-decide', tabId: 12, ...body({ action }) });
    assert.equal(M.validateProtectUiRequest(result.request).ok, true);
    assert.notEqual(result.request.receivers, original.request.receivers);
    original.request.receivers[0] = 'other.example'; assert.deepEqual(result.request.receivers, [M.FW_RECEIVER]);
  }
});

test('every persistent scope requires owned review, with valid current prompt binding still mandatory', () => {
  for (const scope of ['site', 'everywhere']) for (const action of ['allow', 'block']) {
    assert.deepEqual(check(envelope('decide', body({ scope, action }))), { type: 'review' });
    rejected(check(envelope('decide', body({ scope, action, promptId: 'ffffffffffffffff' }))), 'stale-revision');
    rejected(check(envelope('decide', body({ scope, receivers: ['unseen.example'] }))), 'stale-revision');
  }
});

test('global snooze/resume is review-only and invalid minutes never reach it', () => {
  for (const minutes of [0, 60]) assert.deepEqual(check(envelope('snooze', { minutes })), { type: 'review' });
  for (const minutes of [-1, 1, 120, '60', null]) rejected(check(envelope('snooze', { minutes })), 'invalid-request');
});

test('dismiss applies only to the displayed current prompt and never becomes a rule change', () => {
  const { documentKey, protectRevision, promptId } = body();
  const result = check(envelope('dismiss', { documentKey, protectRevision, promptId }));
  assert.deepEqual(result, { type: 'request', request: { schemaVersion: 1, type: 'ui-protect-dismiss', tabId: 12, documentKey, protectRevision, promptId } });
  rejected(check(envelope('dismiss', { documentKey, protectRevision, promptId, scope: 'once' })), 'invalid-request');
  rejected(check(envelope('dismiss', { documentKey, protectRevision: 4, promptId })), 'stale-revision');
});

test('stale document, revision, prompt and site cannot be rebound to a fresh unseen prompt', () => {
  for (const change of [{ documentKey: '12:0:other' }, { protectRevision: 4 }, { protectRevision: 6 }, { promptId: 'ffffffffffffffff' }]) rejected(check(envelope('decide', body(change))), 'stale-revision');
  for (const report of [M.fwProjection({ prompt: null }), M.fwProjection({ over: { documentKey: '12:0:other' } }), M.fwProjection({ over: { protectRevision: 6 } }), M.fwProjection({ over: { site: 'other.example' } })]) rejected(check(envelope(), context(report)), 'stale-revision');
  rejected(check(envelope('decide', body(), { documentKey: '12:0:other' })), 'stale-revision');
});

test('unselected receivers, duplicate names, URL-shaped receivers and array overflow are rejected', () => {
  rejected(check(envelope('decide', body({ receivers: ['unseen.example'] }))), 'stale-revision');
  for (const receivers of [[], [M.FW_RECEIVER, M.FW_RECEIVER], ['https://collect.example.net/'], ['collect.example.net?secret=x'], Array.from({ length: M.PROTECT_BUDGETS.maxPromptReceivers + 1 }, (_, i) => `r${i}.example`)]) rejected(check(envelope('decide', body({ receivers }))), 'invalid-request');
});

test('tab/frame/type/schema or arbitrary extra keys are never accepted from an action body', () => {
  for (const key of ['tabId', 'frameId', 'type', 'schemaVersion', 'host', 'excluded', 'purge', 'url', 'enable', '__proto__']) {
    const value = body(); Object.defineProperty(value, key, { value: key === 'tabId' ? 999 : 'forged', enumerable: true });
    rejected(check(envelope('decide', value)), 'invalid-request');
  }
  for (const key of ['tabId', 'frameId', 'documentId', 'nonce']) rejected(check(envelope('decide', body(), { [key]: 'forged' })), 'invalid-request');
});

test('missing fields, accessors, symbols, inherited bodies and hostile receiver getters are not read', () => {
  const missing = body(); delete missing.scope; rejected(check(envelope('decide', missing)), 'invalid-request');
  let reads = 0;
  const accessor = body(); Object.defineProperty(accessor, 'scope', { enumerable: true, get() { reads++; throw Error('forbidden'); } });
  rejected(check(envelope('decide', accessor)), 'invalid-request');
  const values = [M.FW_RECEIVER]; Object.defineProperty(values, '0', { get() { reads++; throw Error('forbidden'); } });
  rejected(check(envelope('decide', body({ receivers: values }))), 'invalid-request');
  const symbolic = body(); symbolic[Symbol('hidden')] = true; rejected(check(envelope('decide', symbolic)), 'invalid-request');
  rejected(check(envelope('decide', Object.assign(Object.create({ injected: true }), body()))), 'invalid-request');
  assert.equal(reads, 0);
});

test('undo accepts only IDs supplied by the current-document successful-once ledger', () => {
  rejected(check(envelope('undo', { undoId: M.FW_UNDO_ID })), 'not-found');
  const ctx = context(M.fwProjection({ prompt: null }), [M.FW_UNDO_ID]);
  assert.deepEqual(check(envelope('undo', { undoId: M.FW_UNDO_ID }), ctx), { type: 'request', request: { schemaVersion: 1, type: 'ui-protect-undo', tabId: 12, undoId: M.FW_UNDO_ID } });
  rejected(check(envelope('undo', { undoId: 'ffffffffffffffff' }), ctx), 'not-found');
  rejected(check(envelope('undo', { undoId: M.FW_UNDO_ID, tabId: 12 }), ctx), 'invalid-request');
  rejected(check(envelope('undo', { undoId: 'not-an-id' }), ctx), 'invalid-request');
  rejected(check(envelope('undo', { undoId: M.FW_UNDO_ID }), context(M.fwProjection({ over: { documentKey: '12:0:next' } }), [M.FW_UNDO_ID])), 'stale-revision');
});

test('no active module/firewall/excluded report means no inline mutation or global review action', () => {
  for (const over of [{ moduleState: 'off' }, { moduleState: 'needs-consent' }, { features: ['value-match'] }, { limitations: ['site-excluded'] }]) {
    const ctx = context(M.fwProjection({ over }));
    rejected(check(envelope(), ctx), 'module-disabled'); rejected(check(envelope('snooze', { minutes: 60 }), ctx), 'module-disabled');
  }
  rejected(check(envelope(), context(null)), 'stale-revision');
});

test('activation messages, malformed envelopes and every unrelated privileged command fail closed', () => {
  for (const over of [{ kind: 'activation' }, { kind: 'other' }, { generation: 0 }, { generation: NaN }, { generation: '1' }, { schemaVersion: 2 }, { type: 'ui-protect-enable' }]) rejected(check(envelope('decide', body(), over)), 'invalid-request');
  for (const action of ['refresh', 'close', 'settings', 'enable', 'purge', 'export', 'set-site', 'set-settings']) rejected(check(envelope(action, {})), 'invalid-request');
  for (const message of [null, [], {}, undefined, { ...envelope(), request: undefined }]) rejected(M.authorizeOverlayAction(message, context()), 'invalid-request');
});
