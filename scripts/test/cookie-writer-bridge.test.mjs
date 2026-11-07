import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startCookieWriterBridge } from '../production/cookie-writer-bridge-runtime.mjs';
import { readCookieWriterRows, readCookieWriterCache } from '../../packages/contracts/src/cookie-writers.mjs';
const row = { name: '_id', phase: 'returned-sync', script: null, attributionConfidence: 'unknown', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 };
function fixture() {
  let now = 0, next = 0, page, command, hide; const timers = new Map(), sent = [], replies = [];
  startCookieWriterBridge({ onPage: fn => { page = fn; }, onCommand: fn => { command = fn; }, onHide: fn => { hide = fn; }, now: () => now,
    later: (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id; }, cancel: id => timers.delete(id), post: data => sent.push(data) }, readCookieWriterRows);
  const query = (trusted = true, change = {}) => command(trusted, { schemaVersion: 1, type: 'cookie-writers-query', ...change }, data => replies.push(data));
  const answer = (change = {}, sameWindow = true) => page(sameWindow, { channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-batch', requestId: sent.at(-1)?.requestId, enabled: true, rows: [{ ...row }], truncated: false, ...change });
  return { query, answer, hide: () => hide(), sent, replies, timers, tick: value => { now = value; }, fire: delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } } };
}
test('writer bridge requires a trusted SW query and never handles privileged commands from the page', () => {
  const f = fixture(); assert.equal(f.query(false), false); assert.equal(f.query(true, { tabId: 88 }), false); f.answer(); assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  assert.equal(f.query(), true); f.answer(); assert.equal(f.replies.length, 1); assert.ok(readCookieWriterCache(f.replies[0]));
});
test('writer bridge rejects wrong window/id, Cookie values and manufactured browser-observed evidence', () => {
  const f = fixture(); f.query(); f.answer({}, false); f.answer({ requestId: 'cookie-writers-999' }); f.answer({ rows: [{ ...row, value: 'SECRET' }] });
  f.answer({ rows: [{ ...row, evidenceSource: 'browser-network', integrity: 'browser-observed' }] }); assert.equal(f.replies.length, 0);
  f.answer(); assert.equal(f.replies.length, 1); assert.doesNotMatch(JSON.stringify(f.replies), /SECRET/);
});
test('writer bridge timeouts, pagehide and disabled MAIN respond with empty bounded caches', () => {
  const timeout = fixture(); timeout.query(); timeout.fire(400); assert.deepEqual(timeout.replies[0].rows, []); assert.equal(timeout.replies[0].available, false);
  const hidden = fixture(); hidden.query(); hidden.hide(); hidden.answer(); assert.equal(hidden.replies.length, 1); assert.equal(hidden.replies[0].available, false);
  const disabled = fixture(); disabled.query(); disabled.answer({ enabled: false }); assert.deepEqual(disabled.replies[0].rows, []); assert.equal(disabled.replies[0].available, false);
});
test('writer bridge bounds unsolicited candidate admission and concurrent reads', () => {
  const f = fixture(); f.query(); assert.equal(f.query(), false); assert.equal(f.replies[0].available, false);
  for (let i = 0; i < 8; ++i) f.answer({ rows: 'malformed' }); f.answer(); assert.equal(f.replies.length, 1);
  f.fire(400); assert.equal(f.replies.length, 2); assert.equal(f.replies[1].available, false);
  f.tick(100); f.query(); assert.equal(f.sent.length, 1); f.fire(400); assert.equal(f.sent.length, 2);
});
test('unrelated window channels and other request ids cannot consume writer candidate capacity', () => {
  const f = fixture(); f.query();
  for (let i = 0; i < 20; ++i) { f.answer({ channel: 'other/channel' }); f.answer({ type: 'other-message' }); f.answer({ requestId: 'cookie-writers-999' }); }
  f.answer(); assert.equal(f.replies.length, 1); assert.equal(f.replies[0].available, true);
});
