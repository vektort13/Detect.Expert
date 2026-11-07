import test from 'node:test';
import assert from 'node:assert/strict';
import { createFingerprintEngineClient as create, readFingerprintEngineState as read } from '../../apps/production-extension/fingerprint-engine-client.js';
import { FINGERPRINT_ENGINE_PORT } from '../../apps/production-extension/fingerprint-engine-shared.js';
const event = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: value => { for (const fn of listeners) fn(value); } }; };
const state = (sequence = 1, patch = {}) => ({ supported: true, status: 'ready', sequence, sessionOpen: false, revision: null, partial: false, error: null, native: { status: 'idle', attached: false, workerCount: 0, bootstrappedWorkers: 0, unsupported: ['shared-worker', 'service-worker', 'worklet'] }, unsupportedFields: [], ...patch });
function fixture(options = {}) {
  const ports = [], changes = [], env = { location: { href: 'chrome-extension://own/options.html#antidetect' } }; env.top = env;
  const api = { runtime: { getURL: path => 'chrome-extension://own/' + path, connect(data) { assert.equal(data.name, FINGERPRINT_ENGINE_PORT); const port = { sent: [], onMessage: event(), onDisconnect: event(), disconnected: false, postMessage(value) { this.sent.push(value); }, disconnect() { this.disconnected = true; this.onDisconnect.emit(); } }; ports.push(port); return port; } } };
  const client = create(api, { env, onChange: value => changes.push(value), ...options });
  const latest = () => ports.at(-1), reply = (value = state(), ok = true, error = null) => { const port = latest(), command = port.sent.at(-1); port.onMessage.emit({ v: 1, id: command.id, ok, value, error }); };
  return { client, api, env, ports, changes, latest, reply };
}

test('own top-level Options authority is required before connecting; loading never starts a session', async () => {
  const f = fixture(); f.env.location.href = 'https://outside.test/options.html'; await assert.rejects(f.client.load(), /unauthorized/); assert.equal(f.ports.length, 0);
  f.env.location.href = 'chrome-extension://own/options.html'; f.env.top = {}; await assert.rejects(f.client.load(), /unauthorized/); assert.equal(f.ports.length, 0);
  f.env.top = f.env; const pending = f.client.load(); assert.equal(f.latest().sent[0].op, 'load'); f.reply(); await pending;
  assert.equal(f.client.isCertain(), true); assert.equal(f.latest().sent.some(row => row.op === 'start'), false); f.client.dispose();
});

test('snapshot projection drops raw extras and rejects invalid counts/accessor fields without invoking getters', () => {
  const projected = read({ ...state(), url: 'raw-user-url', source: 'raw-source' });
  assert.equal(Object.isFrozen(projected.native), true); assert.equal(JSON.stringify(projected).includes('raw-'), false);
  assert.throws(() => read(state(1, { native: { ...state().native, workerCount: 65 } })), /invalid-input/);
  let reads = 0; const bad = state(); Object.defineProperty(bad, 'sessionOpen', { get() { reads++; throw Error('no'); } }); assert.throws(() => read(bad), /invalid-input/); assert.equal(reads, 0);
});

test('only explicit Start sends closed URL/revision payload and repeated clicks are singleflight', async () => {
  const f = fixture(); await assert.rejects(f.client.start('https://qa.example/', 7), /not-ready/);
  const loading = f.client.load(); f.reply(); await loading;
  await assert.rejects(f.client.start('https://user:pass@qa.example/', 7), /invalid-input/);
  const pending = f.client.start('https://qa.example/path?q=owned', 7); await assert.rejects(f.client.start('https://qa.example/', 7), /busy/);
  assert.deepEqual(f.latest().sent.at(-1).payload, { url: 'https://qa.example/path?q=owned', expectedRevision: 7 });
  f.reply(state(2, { status: 'running', sessionOpen: true, revision: 7 })); assert.equal((await pending).status, 'running'); f.client.dispose();
});

test('newer broadcast state is retained when an older acknowledgement arrives; foreign replies do nothing', async () => {
  const f = fixture(); const pending = f.client.load(); f.latest().onMessage.emit({ v: 1, id: 'foreign', ok: true, value: state(99) }); assert.equal(f.client.isBusy(), true);
  f.latest().onMessage.emit({ v: 1, type: 'state', value: state(5, { status: 'running', sessionOpen: true }) });
  f.reply(state(4)); assert.equal((await pending).sequence, 5); assert.equal(f.changes.at(-1).status, 'running'); f.client.dispose();
});

test('timed-out mutation is never replayed; late old-port state is ignored and explicit recovery is read-only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture({ deadlineMs: 10 });
  const loading = f.client.load(); f.reply(); await loading;
  const starting = f.client.start('https://qa.example/', 7); const rejection = assert.rejects(starting, /timeout/), old = f.latest(); t.mock.timers.tick(10); await rejection;
  assert.equal(old.disconnected, true); assert.equal(f.client.isBusy(), false); await assert.rejects(f.client.start('https://qa.example/', 7), /not-ready/);
  const changes = f.changes.length; old.onMessage.emit({ v: 1, type: 'state', value: state(100, { status: 'running', sessionOpen: true }) }); assert.equal(f.changes.length, changes);
  const recovery = f.client.recover(); assert.equal(f.latest().sent[0].op, 'load'); f.reply(state(2, { status: 'running', sessionOpen: true })); await recovery;
  assert.equal(f.ports.flatMap(port => port.sent).filter(row => row.op === 'start').length, 1); f.client.dispose();
});

test('explicit Stop remains available after uncertain timeout and does not depend on a valid URL/profile', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture({ deadlineMs: 10 }); const reading = f.client.load(), rejected = assert.rejects(reading, /timeout/); t.mock.timers.tick(10); await rejected;
  const closing = f.client.stop(); assert.deepEqual(Object.keys(f.latest().sent[0]), ['v', 'id', 'op']); assert.equal(f.latest().sent[0].op, 'stop'); f.reply(); await closing; f.client.dispose();
});

test('hidden/disposed clients reject old work without stopping or replaying the background session', async () => {
  const f = fixture(); const loading = f.client.load(), rejection = assert.rejects(loading, /inactive/); const old = f.latest(); f.client.setActive(false); await rejection;
  old.onMessage.emit({ v: 1, type: 'state', value: state(99) }); assert.equal(f.changes.length, 0); assert.equal(old.sent.some(row => row.op === 'stop'), false);
  f.client.setActive(true); const reading = f.client.load(); f.reply(); await reading;
  const starting = f.client.start('https://qa.example/', 7), stopped = assert.rejects(starting, /inactive/); f.client.dispose(); await stopped; await assert.rejects(f.client.load(), /inactive/);
});

test('disconnect and malformed response never silently reconnect, replay or authorize a new mutation', async () => {
  const f = fixture(); const pending = f.client.load(), rejected = assert.rejects(pending, /native-error/); f.latest().onDisconnect.emit(); await rejected; assert.equal(f.ports.length, 1);
  const retry = f.client.load(), invalid = assert.rejects(retry, /invalid-input/); f.reply({ ...state(), native: {} }); await invalid; assert.equal(f.client.isCertain(), false);
  await assert.rejects(f.client.start('https://qa.example/', 7), /not-ready/); f.client.dispose();
});
