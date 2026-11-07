// ADR-020 §A, §F (S05): MAIN <-> ISOLATED relay of the module «Защита». Handshake on the module channel (routing,
// not authentication), foreign channels and own echoes ignored, sequence checks, tMs -> ageMs on the ISOLATED clock
// (future beyond +50 ms and older than maxSampleAgeMs dropped), ≤ 4 protect-events/s with ≤ 32 samples, pause /
// resume / stop, an inactive answer ends the module.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL,
  PROTECT_BUDGETS,
  PROTECT_CHANNEL,
  PROTECT_MAIN_PROTOCOL_VERSION,
  UNBOUND_SENSOR_BOOT_ID,
  validateProtectPageMessage,
} from '@detect-expert/contracts';
import type { ProtectEventsMessage, RegistrationSampleWire, SendSampleWire } from '@detect-expert/contracts';
import { startProtectIsolated } from '../src/protect/index';
import { ProtectRelay, RELAY_HELLO_INTERVAL_MS, RELAY_HELLO_RETRIES, RELAY_MAX_BOOTS, RELAY_MAX_PENDING_SAMPLES, stopUnboundMain } from '../src/protect/relay';
import { FakeProtectEnv, ack, settle } from './protect-fakes';

const BOOT = 'mainboot0001';

function relay(env = new FakeProtectEnv(), onInactive: () => void = () => undefined): { env: FakeProtectEnv; relay: ProtectRelay } {
  const r = new ProtectRelay(env, (m) => env.posted.push(m), { onInactive });
  r.start();
  return { env, relay: r };
}

function mainHello(sensorBootId = BOOT, protocolVersion: number = PROTECT_MAIN_PROTOCOL_VERSION): Record<string, unknown> {
  return { channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-main-hello', protocolVersion, startedLate: false, groups: 3 };
}

function send(tMs: number, sensorSeq = 1): SendSampleWire {
  return { hookPoint: 'send-fetch', sensorSeq, tMs, script: { kind: 'unknown' }, sampled: false, target: { kind: 'relative' } };
}

function registration(tMs: number, count = 2): RegistrationSampleWire {
  return { hookPoint: 'listen', eventCode: 'input', targetKind: 'document', script: { kind: 'document' }, sampled: true, count, tMs };
}

function batch(sensorSeq: number, sends: SendSampleWire[], registrations: RegistrationSampleWire[] = [], sensorBootId = BOOT): Record<string, unknown> {
  return { channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-main-batch', sensorSeq, sends, registrations, dropped: { sends: 0, registrations: 0, unsampled: 0 }, limitations: [] };
}

function events(env: FakeProtectEnv): ProtectEventsMessage[] {
  return env.messages('protect-events');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handshake', () => {
  it('announces itself unbound with a relaySessionId and retries a bounded number of times', () => {
    const { env } = relay();
    expect(env.posted[0]).toEqual({
      channel: PROTECT_CHANNEL,
      sensorBootId: UNBOUND_SENSOR_BOOT_ID,
      type: 'protect-relay-hello',
      protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION,
      relaySessionId: expect.stringMatching(/^[0-9a-f]{16}$/),
      paused: false,
    });
    vi.advanceTimersByTime(10_000);
    expect(env.posted.filter((m) => m.type === 'protect-relay-hello')).toHaveLength(RELAY_HELLO_RETRIES);
  });

  it('binds a MAIN boot with one bound hello; a repeated hello changes nothing; retries stop', () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello());
    env.postWindow(mainHello());
    const bound = env.posted.filter((m) => m.sensorBootId === BOOT);
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({ type: 'protect-relay-hello', relaySessionId: (env.posted[0] as { relaySessionId: string }).relaySessionId });
    vi.advanceTimersByTime(5000);
    expect(env.posted).toHaveLength(2);
    expect(r.snapshot().boots).toBe(1);
  });

  it('a protocol mismatch gets protect-relay-stop (protocol-mismatch) and is not bound', () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello(BOOT, PROTECT_MAIN_PROTOCOL_VERSION + 1));
    expect(env.posted.at(-1)).toEqual({ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-stop', reason: 'protocol-mismatch' });
    expect(r.snapshot().boots).toBe(0);
  });

  it('foreign windows, the observation channel and its own echoed posts are ignored; malformed messages are counted', () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello(), false);
    env.postWindow({ ...mainHello(), channel: CHANNEL });
    env.postWindow(env.posted[0]); // our own unbound hello echoed by the window
    expect(r.snapshot()).toMatchObject({ boots: 0, rejected: 0 });
    env.postWindow({ ...mainHello(), extra: 'x' });
    env.postWindow({ ...mainHello(), sensorBootId: 'bad id!' });
    expect(r.snapshot()).toMatchObject({ boots: 0, rejected: 2 });
  });
});

describe('batches', () => {
  it('rejects batches of unknown boots, repeated or far-jumping sequences', async () => {
    const { env, relay: r } = relay();
    env.postWindow(batch(1, [send(9_990)]));
    env.postWindow(mainHello());
    env.postWindow(batch(1, [send(9_990)]));
    env.postWindow(batch(1, [send(9_990)]));
    env.postWindow(batch(100, [send(9_990)]));
    await vi.advanceTimersByTimeAsync(10);
    expect(r.snapshot().rejected).toBe(3);
    expect(events(env)).toHaveLength(1);
    expect(events(env)[0]!.sends).toHaveLength(1);
  });

  it('tMs -> ageMs on the ISOLATED clock; future beyond +50 ms and stale samples are dropped into `dropped`', async () => {
    const { env } = relay();
    env.mono = 10_000;
    env.postWindow(mainHello());
    env.postWindow(batch(1, [send(9_500, 1), send(10_040, 2), send(10_100, 3), send(4_000, 4)], [registration(9_000, 5), registration(3_000, 7)]));
    await vi.advanceTimersByTimeAsync(10);
    const [message] = events(env);
    expect(message).toBeDefined();
    expect(message!.sends.map((s) => [s.sensorSeq, s.ageMs])).toEqual([[1, 500], [2, 0]]);
    expect(message!.registrations.map((s) => [s.count, s.ageMs, s.eventCode])).toEqual([[5, 1000, 'input']]);
    expect(message!.dropped).toEqual({ sends: 2, registrations: 7, unsampled: 0 });
    expect(message).toMatchObject({ schemaVersion: 1, type: 'protect-events', sensorBootId: BOOT, batchSeq: 1 });
    expect(validateProtectPageMessage(message).ok).toBe(true);
    // No page-clock time crosses to the SW.
    expect(JSON.stringify(message)).not.toContain('tMs');
  });

  it('a sample that waits past maxSampleAgeMs is dropped when it is finally sent', async () => {
    const { env } = relay();
    env.mono = 10_000;
    env.postWindow(mainHello());
    env.postWindow(batch(1, [send(9_990)]));
    env.mono = 10_000 + PROTECT_BUDGETS.maxSampleAgeMs + 100;
    await vi.advanceTimersByTimeAsync(10);
    expect(events(env)[0]).toMatchObject({ sends: [], dropped: { sends: 1 } });
  });

  it('≤ 4 protect-events per second, ≤ 32 samples each; overflow is dropped with budget-exceeded', async () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello());
    for (let seq = 1; seq <= 8; seq++) env.postWindow(batch(seq, Array.from({ length: 32 }, (_, i) => send(9_990, seq * 100 + i))));
    expect(r.snapshot().pending).toBe(RELAY_MAX_PENDING_SAMPLES);
    await vi.advanceTimersByTimeAsync(10);
    expect(events(env)).toHaveLength(4);
    for (const m of events(env)) {
      expect(m.sends.length + m.registrations.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxItemsPerBatch);
      expect(validateProtectPageMessage(m).ok).toBe(true);
    }
    const first = events(env)[0]!;
    expect(first.limitations).toContain('budget-exceeded');
    expect(first.dropped.sends).toBe(8 * 32 - RELAY_MAX_PENDING_SAMPLES);
    env.postWindow(batch(9, [send(9_990, 999)]));
    await vi.advanceTimersByTimeAsync(500);
    expect(events(env)).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(600);
    expect(events(env)).toHaveLength(5);
    const times = env.sent.filter((s) => s.message.type === 'protect-events').map((s) => s.at);
    for (let i = 4; i < times.length; i++) expect(times[i]! - times[i - 4]!).toBeGreaterThanOrEqual(1000);
    expect(events(env).map((m) => m.batchSeq)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('pause, resume, stop, inactive', () => {
  it('pause / resume go to every bound boot; samples while paused become `dropped`', async () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello());
    r.pause();
    expect(env.posted.at(-1)).toEqual({ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-pause' });
    env.postWindow(batch(1, [send(9_990), send(9_990, 2)], [registration(9_990, 3)]));
    await vi.advanceTimersByTimeAsync(100);
    expect(events(env)).toEqual([]);
    r.resume();
    expect(env.posted.at(-1)).toEqual({ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-resume' });
    await vi.advanceTimersByTimeAsync(10);
    expect(events(env)).toHaveLength(1);
    expect(events(env)[0]).toMatchObject({ sends: [], registrations: [], dropped: { sends: 2, registrations: 3, unsampled: 0 } });
  });

  it('stop: protect-relay-stop to every bound boot, the listener goes, nothing is relayed afterwards', async () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello());
    r.stop('revoked');
    expect(env.posted.at(-1)).toEqual({ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-stop', reason: 'revoked' });
    expect(env.listenerCount()).toBe(0);
    env.postWindow(batch(1, [send(9_990)]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(events(env)).toEqual([]);
  });

  it('an inactive answer of the SW ends the module (onInactive)', async () => {
    const env = new FakeProtectEnv();
    env.respond = () => ack({ active: false, groups: 0, saltId: undefined, salt: undefined });
    let inactive = 0;
    relay(env, () => inactive++);
    env.postWindow(mainHello());
    env.postWindow(batch(1, [send(9_990)]));
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(inactive).toBe(1);
  });

  it('review W1: stopUnboundMain stops every MAIN boot that announces itself in the bounded window, then goes', () => {
    const env = new FakeProtectEnv();
    const post = (m: Parameters<typeof env.posted.push>[0]): number => env.posted.push(m);
    stopUnboundMain(env, post);
    expect(env.posted[0]).toMatchObject({ channel: PROTECT_CHANNEL, sensorBootId: UNBOUND_SENSOR_BOOT_ID, type: 'protect-relay-hello', paused: true });
    env.postWindow(mainHello());
    env.postWindow(mainHello()); // repeated: one stop per boot
    env.postWindow(mainHello('mainboot0002'), false); // not from this window: ignored
    env.postWindow({ ...mainHello('mainboot0003'), channel: CHANNEL }); // observation channel: ignored
    env.postWindow(mainHello(UNBOUND_SENSOR_BOOT_ID));
    const stops = (): unknown[] => env.posted.filter((m) => m.type === 'protect-relay-stop');
    expect(stops()).toEqual([{ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-stop', reason: 'revoked' }]);
    for (let i = 0; i < RELAY_MAX_BOOTS + 2; i++) env.postWindow(mainHello('mainboot1' + String(i).padStart(3, '0')));
    expect(stops()).toHaveLength(RELAY_MAX_BOOTS);
    vi.advanceTimersByTime(RELAY_HELLO_RETRIES * RELAY_HELLO_INTERVAL_MS + 1000);
    expect(env.posted.filter((m) => m.type === 'protect-relay-hello')).toHaveLength(RELAY_HELLO_RETRIES);
    expect(env.listenerCount(), 'the sweep is bounded: its listener goes').toBe(0);
  });

  it('review W1: an inactive or failed first hello (no relay) still stops the MAIN hooks of the document', async () => {
    for (const answer of ['inactive', 'rejected', 'unreadable'] as const) {
      const env = new FakeProtectEnv();
      env.respond = () => {
        if (answer === 'rejected') throw new Error('Could not establish connection.');
        return answer === 'inactive' ? ack({ active: false, groups: 0, saltId: undefined, salt: undefined }) : { type: 'protect-ack' };
      };
      const handle = startProtectIsolated(env, (m) => env.posted.push(m));
      await settle();
      expect(handle.snapshot().session.state, answer).toBe('stopped');
      expect(handle.snapshot().relay, answer).toBeNull();
      // MAIN answers the sweep's unbound hello with its boot id; the only post addressed to it is a stop.
      env.postWindow(mainHello());
      expect(env.posted.filter((m) => m.sensorBootId === BOOT), answer).toEqual([{ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-stop', reason: 'revoked' }]);
      vi.advanceTimersByTime(RELAY_HELLO_RETRIES * RELAY_HELLO_INTERVAL_MS + 1000);
      expect(env.listenerCount(), answer).toBe(0);
    }
  });

  it('review W1: an active answer binds MAIN through the relay; no stop is posted', async () => {
    const env = new FakeProtectEnv();
    const handle = startProtectIsolated(env, (m) => env.posted.push(m));
    await settle();
    expect(handle.snapshot().relay?.state).toBe('running');
    env.postWindow(mainHello());
    expect(env.posted.filter((m) => m.sensorBootId === BOOT)).toEqual([expect.objectContaining({ type: 'protect-relay-hello', paused: false })]);
    expect(env.posted.some((m) => m.type === 'protect-relay-stop')).toBe(false);
    handle.stop();
    expect(env.posted.filter((m) => m.type === 'protect-relay-stop')).toEqual([{ channel: PROTECT_CHANNEL, sensorBootId: BOOT, type: 'protect-relay-stop', reason: 'revoked' }]);
  });

  it('empty MAIN batches are invalid and never relayed', async () => {
    const { env, relay: r } = relay();
    env.postWindow(mainHello());
    env.postWindow(batch(1, []));
    await vi.advanceTimersByTimeAsync(10);
    expect(events(env)).toEqual([]);
    expect(r.snapshot().rejected).toBe(1);
  });
});
