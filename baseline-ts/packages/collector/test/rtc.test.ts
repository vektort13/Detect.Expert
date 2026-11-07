// ADR-020: deterministic transport/lifecycle tests, no page/network/WebRTC implementation mocks.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RTC_DETAILS_CHANNEL, RTC_LIMITS } from '@detect-expert/contracts';
import type { RtcControl, RtcPageRequest, RtcSnapshot } from '@detect-expert/contracts';
import { startRtcBridge } from '../src/rtc';
import type { RtcBridgeEnv } from '../src/rtc';
import { FakeEnv, obs, sensorBatch, sensorHello } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const boot = 'boot-' + 'a'.repeat(24);
const token = 'c'.repeat(32);
const hello = (epoch = 0) => ({ channel: RTC_DETAILS_CHANNEL, type: 'rtc-hello', sensorBootId: boot, epoch });
const config = (enabled = true, reset = false): RtcControl => ({ schemaVersion: 1, type: 'rtc-control', enabled, token: enabled ? token : null, reset });
const ack = (accepted = true, reset = false) => ({ schemaVersion: 1, type: 'rtc-ack', accepted, reset });
function snapshot(revision = 1, host = 'stun.example.com'): RtcSnapshot {
  return { revision, total: 1, omitted: 0, captureLimited: false, connections: [{ id: 1, created: true,
    closed: true, connected: false, state: 'closed', duration: 'under-1s', configurationChanges: 0, truncated: false,
    servers: [{ scheme: 'stun', host, port: 3478, transport: null, configured: true, candidate: false, error: false }] }] };
}
const message = (revision = 1, epoch = 0, host = 'stun.example.com') => ({ ...hello(epoch), type: 'rtc-snapshot', snapshot: snapshot(revision, host) });
function setup(response: (request: RtcPageRequest) => unknown = request => request.type === 'rtc-ready' ? config() : ack()) {
  const base = new FakeEnv();
  const posted: Record<string, unknown>[] = [];
  const sent: Array<{ request: RtcPageRequest; at: number }> = [];
  const env: RtcBridgeEnv = {
    onWindowMessage: base.onWindowMessage.bind(base), onControlMessage: base.onControlMessage.bind(base), onPageHide: base.onPageHide.bind(base),
    setTimer: base.setTimer.bind(base), clearTimer: base.clearTimer.bind(base), now: base.now.bind(base), isContextAlive: base.isContextAlive.bind(base),
    postToPage: value => { posted.push(value as Record<string, unknown>); base.emit(value); },
    sendToBackground: async value => {
      const request = value as RtcPageRequest;
      sent.push({ request: structuredClone(request), at: base.now() });
      return response(request);
    },
  };
  startRtcBridge(env);
  return { base, posted, sent,
    snapshots: () => sent.flatMap(({ request }) => request.type === 'rtc-snapshot' ? [request] : []),
    ready: () => sent.filter(({ request }) => request.type === 'rtc-ready'),
  };
}

it('keeps the owner token out of MAIN and sends the complete retained short connection only to SW', async () => {
  const h = setup(); h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message()); await vi.advanceTimersByTimeAsync(RTC_LIMITS.flushMs);
  expect(h.snapshots()).toEqual([{ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: snapshot() }]);
  expect(h.posted).toContainEqual({ channel: RTC_DETAILS_CHANNEL, type: 'rtc-request', sensorBootId: boot, epoch: 0 });
  expect(JSON.stringify(h.posted)).not.toContain(token);
  expect(JSON.stringify(h.posted)).not.toContain('stun.example.com');
});

it('rejects other-window messages, forged trusted controls, changed boot and invalid credential fields', async () => {
  const h = setup();
  h.base.emit(hello(), false); h.base.emit(message(), false);
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' }, false);
  await vi.advanceTimersByTimeAsync(1000); expect(h.sent).toEqual([]);
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.control({ schemaVersion: 1, type: 'rtc-reset' }, false);
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' }, false);
  h.base.emit({ ...message(), sensorBootId: 'boot-' + 'b'.repeat(24) });
  await vi.advanceTimersByTimeAsync(100);
  const invalid = message();
  h.base.emit({ ...invalid, snapshot: { ...invalid.snapshot, credential: 'MUST_NOT_LEAVE_ISOLATED' } });
  await vi.advanceTimersByTimeAsync(100);
  h.base.emit(message()); await vi.advanceTimersByTimeAsync(250);
  expect(h.snapshots()).toHaveLength(1);
  expect(h.posted.some(value => value['type'] === 'rtc-reset')).toBe(false);
  expect(JSON.stringify(h.sent)).not.toContain('MUST_NOT_LEAVE_ISOLATED');
});

it('coalesces pending history and preserves a newer close/update arriving during an in-flight acknowledgement', async () => {
  let finish!: (value: unknown) => void;
  let commits = 0;
  const h = setup(request => request.type === 'rtc-ready' ? config() : ++commits === 1 ? new Promise(resolve => { finish = resolve; }) : ack());
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message(1)); await vi.advanceTimersByTimeAsync(100);
  h.base.emit(message(2)); await vi.advanceTimersByTimeAsync(100);
  h.base.emit(message(3)); await vi.advanceTimersByTimeAsync(50);
  expect(h.snapshots().map(value => value.snapshot.revision)).toEqual([3]);
  await vi.advanceTimersByTimeAsync(100); h.base.emit(message(4));
  await vi.advanceTimersByTimeAsync(1000); expect(h.snapshots()).toHaveLength(1);
  finish(ack()); await vi.advanceTimersByTimeAsync(250);
  expect(h.snapshots().map(value => value.snapshot.revision)).toEqual([3, 4]);
  expect(h.snapshots()[1]!.snapshot.connections[0]!.duration).toBe('under-1s');
});

it('bounds acknowledgement retries and hello retry floods after transport failure', async () => {
  const snapshotsFail = setup(request => { if (request.type === 'rtc-ready') return config(); throw new Error('transient'); });
  snapshotsFail.base.emit(hello()); await vi.advanceTimersByTimeAsync(0); snapshotsFail.base.emit(message());
  await vi.advanceTimersByTimeAsync(10000);
  expect(snapshotsFail.snapshots()).toHaveLength(4);
  expect(vi.getTimerCount()).toBe(0);
  const helloFail = setup(() => { throw new Error('offline'); });
  for (let i = 0; i < 1000; i++) { helloFail.base.emit(hello()); await vi.advanceTimersByTimeAsync(0); }
  await vi.advanceTimersByTimeAsync(10000);
  expect(helloFail.ready().length).toBeLessThanOrEqual(4);
  expect(vi.getTimerCount()).toBe(0);
});

for (const reason of ['pause', 'denied'] as const) it(reason + ' blocks fresh handshakes and history until a trusted resume', async () => {
  let enabled = reason !== 'denied';
  const h = setup(request => request.type === 'rtc-ready' ? config(enabled) : ack());
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  if (reason === 'pause') h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' });
  const before = h.sent.length;
  for (let i = 0; i < 1000; i++) { h.base.emit(hello(1)); h.base.emit(message(i + 1, 1)); }
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' }, false);
  await vi.advanceTimersByTimeAsync(5000); expect(h.sent).toHaveLength(before);
  enabled = true;
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  await vi.advanceTimersByTimeAsync(250); h.base.emit(message(1, 1)); await vi.advanceTimersByTimeAsync(250);
  expect(h.snapshots()).toHaveLength(1);
});

it('terminal stop and invalidated contexts cannot be restarted by later controls or page data', async () => {
  const h = setup(); h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'stop' });
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  h.base.emit(hello(1)); h.base.emit(message(1, 1)); await vi.advanceTimersByTimeAsync(5000);
  expect(h.sent).toHaveLength(1);
  const dead = setup(); dead.base.alive = false; dead.base.emit(hello()); dead.base.emit(message());
  await vi.advanceTimersByTimeAsync(5000); expect(dead.sent).toEqual([]);
});

it('increments the public epoch on clear and ignores queued old/future snapshots and delayed old reset ACK', async () => {
  let oldAck!: (value: unknown) => void;
  let commits = 0;
  const h = setup(request => request.type === 'rtc-ready' ? config() : ++commits === 1 ? new Promise(resolve => { oldAck = resolve; }) : ack());
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0); h.base.emit(message()); await vi.advanceTimersByTimeAsync(250);
  h.base.control({ schemaVersion: 1, type: 'rtc-reset' }); await vi.advanceTimersByTimeAsync(250);
  expect(h.posted.filter(value => value['type'] === 'rtc-reset').map(value => value['epoch'])).toEqual([1]);
  h.base.emit(message(999, 0, 'old.example.com')); await vi.advanceTimersByTimeAsync(100);
  h.base.emit(message(999, 2, 'future.example.com')); await vi.advanceTimersByTimeAsync(100);
  h.base.emit(message(1, 1, 'current.example.com')); await vi.advanceTimersByTimeAsync(250);
  oldAck(ack(false, true)); await vi.advanceTimersByTimeAsync(1000);
  expect(h.snapshots().map(value => value.snapshot.connections[0]!.servers[0]!.host)).toEqual(['stun.example.com', 'current.example.com']);
  expect(h.posted.filter(value => value['type'] === 'rtc-reset').map(value => value['epoch'])).toEqual([1]);
  expect(JSON.stringify(h.posted)).not.toContain(token);
});

it('ignores a late authorization after pause instead of restoring a cleared owner', async () => {
  let answer!: (value: unknown) => void;
  const h = setup(() => new Promise(resolve => { answer = resolve; }));
  h.base.emit(hello()); h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' });
  answer(config()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message(1, 1)); await vi.advanceTimersByTimeAsync(1000);
  expect(h.sent).toHaveLength(1);
  expect(h.posted.filter(value => value['type'] === 'rtc-request')).toEqual([]);
});

it('bounds repeated page floods to at most four metadata deliveries per second', async () => {
  const h = setup(request => request.type === 'rtc-ready' ? config() : ack());
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  for (let step = 0; step < 20; step++) {
    for (let i = 0; i < 100; i++) h.base.emit(message(step * 100 + i + 1));
    await vi.advanceTimersByTimeAsync(100);
  }
  await vi.advanceTimersByTimeAsync(1000);
  const sends = h.sent.filter(value => value.request.type === 'rtc-snapshot');
  expect(sends.length).toBeGreaterThan(0);
  expect(sends.length).toBeLessThanOrEqual(9);
  for (let i = 1; i < sends.length; i++) expect(sends[i]!.at - sends[i - 1]!.at).toBeGreaterThanOrEqual(RTC_LIMITS.flushMs);
  expect(vi.getTimerCount()).toBe(0);
});

it('flushes a pending short connection on trusted pagehide before its normal timer', async () => {
  const h = setup(); h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message()); h.base.pagehide(false); await vi.advanceTimersByTimeAsync(0);
  expect(h.snapshots()).toHaveLength(1);
  expect(h.snapshots()[0]!.snapshot.connections[0]!.closed).toBe(true);
  await vi.advanceTimersByTimeAsync(1000); expect(h.snapshots()).toHaveLength(1);
});

for (const phase of ['rtc-ready', 'rtc-snapshot'] as const) it('recovers from a hung ' + phase + ' after two seconds and ignores its eventual stale response', async () => {
  let reply!: (value: unknown) => void;
  let calls = 0;
  const h = setup(request => {
    if (request.type === phase && ++calls === 1) return new Promise(resolve => { reply = resolve; });
    return request.type === 'rtc-ready' ? config() : ack();
  });
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message()); await vi.advanceTimersByTimeAsync(250);
  const startedAt = h.sent.find(value => value.request.type === phase)!.at;
  await vi.advanceTimersByTimeAsync(startedAt + 1999 - h.base.now());
  h.base.emit(message(2));
  expect(h.sent.filter(value => value.request.type === phase)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(501);
  expect(h.sent.filter(value => value.request.type === phase)).toHaveLength(2);
  expect(h.snapshots().at(-1)!.snapshot.revision).toBe(2);
  reply(phase === 'rtc-ready' ? config(false, true) : ack(false, true));
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.posted.filter(value => value['type'] === 'rtc-reset')).toEqual([]);
  expect(h.sent.filter(value => value.request.type === phase)).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

for (const phase of ['rtc-ready', 'rtc-snapshot'] as const) it('caps actual unresolved ' + phase + ' callbacks across floods/resets and recovers when a slot frees', async () => {
  let available = false;
  const replies: Array<(value: unknown) => void> = [];
  const h = setup(request => {
    if (request.type === phase && !available) return new Promise(resolve => { replies.push(resolve); });
    return request.type === 'rtc-ready' ? config() : ack();
  });
  h.base.emit(hello()); await vi.advanceTimersByTimeAsync(0);
  h.base.emit(message()); await vi.advanceTimersByTimeAsync(20000);
  expect(replies).toHaveLength(4);
  expect(vi.getTimerCount()).toBe(0);
  for (let i = 0; i < 100; i++) {
    h.base.emit(hello()); h.base.emit(message(i + 10)); await vi.advanceTimersByTimeAsync(100);
  }
  expect(replies).toHaveLength(4);
  h.base.control({ schemaVersion: 1, type: 'rtc-reset' });
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' });
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  await vi.advanceTimersByTimeAsync(250);
  h.base.emit(hello(2)); h.base.emit(message(1, 2, 'after-clear.example.com'));
  await vi.advanceTimersByTimeAsync(10000);
  expect(replies).toHaveLength(4);
  expect(vi.getTimerCount()).toBe(0);
  available = true;
  replies[0]!(phase === 'rtc-ready' ? config(false, true) : ack(false, true));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.snapshots().at(-1)!.snapshot.connections[0]!.servers[0]!.host).toBe('after-clear.example.com');
  expect(h.posted.filter(value => value['type'] === 'rtc-reset').map(value => value['epoch'])).toEqual([1, 2]);
  expect(replies).toHaveLength(4);
  expect(vi.getTimerCount()).toBe(0);
});

for (const control of ['pause', 'clear'] as const) it('aligns the first MAIN hello after an early trusted ' + control + ' without restoring stale history', async () => {
  const h = setup();
  h.base.control(control === 'pause' ? { schemaVersion: 1, type: 'bridge-control', command: 'pause' } : { schemaVersion: 1, type: 'rtc-reset' });
  if (control === 'pause') {
    h.base.emit(hello());
    h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  }
  await vi.advanceTimersByTimeAsync(500);
  expect(h.sent).toEqual([]);
  h.base.emit(message(9)); // Queued pre-reset data cannot initialize the stale route.
  h.base.emit(hello());
  expect(h.posted).toContainEqual({ channel: RTC_DETAILS_CHANNEL, type: 'rtc-reset', sensorBootId: boot, epoch: 1 });
  await vi.advanceTimersByTimeAsync(250);
  h.base.emit(message(10)); await vi.advanceTimersByTimeAsync(100);
  h.base.emit(hello(1)); h.base.emit(message(1, 1, 'new-epoch.example.com')); await vi.advanceTimersByTimeAsync(250);
  expect(h.snapshots().map(value => value.snapshot.connections[0]!.servers[0]!.host)).toEqual(['new-epoch.example.com']);
  expect(h.ready()).toHaveLength(1);
});

it('does no RTC background work for ordinary Canvas-only traffic, including pause/resume and clear', async () => {
  const h = setup();
  h.base.emit(sensorHello(boot));
  h.base.emit(sensorBatch(boot, 1, [obs({ techniqueId: 'DET-001' })]));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.sent).toEqual([]); expect(h.posted).toEqual([]);
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' });
  h.base.emit(sensorHello(boot));
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  h.base.emit(sensorBatch(boot, 2, [obs({ techniqueId: 'DET-002' })]));
  await vi.advanceTimersByTimeAsync(1000);
  h.base.control({ schemaVersion: 1, type: 'rtc-reset' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.sent).toEqual([]);
  expect(h.posted.map(value => [value['type'], value['epoch']])).toEqual([['rtc-reset', 1], ['rtc-reset', 2]]);
  expect(vi.getTimerCount()).toBe(0);
});

for (const order of ['before-pause', 'during-pause', 'after-resume'] as const) it('ordinary hello ' + order + ' aligns epoch before the first same-turn closed WebRTC connection', async () => {
  const h = setup();
  if (order === 'before-pause') h.base.emit(sensorHello(boot));
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' });
  if (order === 'during-pause') h.base.emit(sensorHello(boot));
  h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'resume' });
  if (order === 'after-resume') h.base.emit(sensorHello(boot));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.sent).toEqual([]);
  expect(h.posted).toEqual([{ channel: RTC_DETAILS_CHANNEL, type: 'rtc-reset', sensorBootId: boot, epoch: 1 }]);
  expect(vi.getTimerCount()).toBe(0);
  // MAIN has already received epoch 1 before creating and closing its first object in one task.
  h.base.emit(hello(1)); h.base.emit(message(1, 1));
  await vi.advanceTimersByTimeAsync(250);
  expect(h.ready()).toHaveLength(1);
  expect(h.snapshots()).toEqual([{ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: snapshot() }]);
  expect(h.posted.filter(value => value['type'] === 'rtc-reset')).toHaveLength(1);
});

it('learns no route from foreign or invalid ordinary hellos and cannot change the established route', async () => {
  const h = setup();
  h.base.emit(sensorHello('wrong-world'), false);
  h.base.emit(sensorHello('wrong-protocol', { protocolVersion: 999 }));
  h.base.emit(sensorHello('wrong-shape', { credential: 'must-not-be-read' }));
  h.base.control({ schemaVersion: 1, type: 'rtc-reset' });
  expect(h.posted).toEqual([]);
  h.base.emit(sensorHello(boot));
  h.base.emit(sensorHello('boot-' + 'b'.repeat(24)));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.sent).toEqual([]);
  expect(h.posted).toEqual([{ channel: RTC_DETAILS_CHANNEL, type: 'rtc-reset', sensorBootId: boot, epoch: 1 }]);
  h.base.emit(hello(1)); h.base.emit(message(1, 1)); await vi.advanceTimersByTimeAsync(250);
  expect(h.snapshots()).toHaveLength(1);
});
