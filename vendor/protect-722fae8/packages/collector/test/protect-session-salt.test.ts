// S07 (foundation follow-up 89): the ISOLATED session reads e-mail / phone / name values only while the SW ack carries a
// salt (the value-match feature is on). Without a salt the module may be active for other features, but no value is
// read at all; a salt that arrives later re-reads the tracked fields once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectSession } from '../src/protect/session';
import { FakeProtectEnv, ack, input, settle } from './protect-fakes';

const CANARY = 'salt-gate.canary@example.test';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('value reads need the SW salt (value-match on)', () => {
  it('active without a salt: focus, input, blur and submit read nothing and send no protect-input', async () => {
    const env = new FakeProtectEnv();
    env.respond = () => ack({ saltId: undefined, salt: undefined });
    let fingerprintCalls = 0;
    const session = new ProtectSession(env, { fingerprints: () => {
      fingerprintCalls++;
      return [{ enc: 'plain', len: 3, h: '0123456789abc' }];
    } });
    session.start();
    await settle();
    expect(session.snapshot().state).toBe('active');
    const el = input({ type: 'email', name: 'email' });
    env.fire('focusin', el);
    el.type(CANARY);
    env.fire('input', el);
    await vi.advanceTimersByTimeAsync(1000);
    env.fire('focusout', el);
    env.fire('pagehide', el);
    await settle();
    expect(el.reads).toBe(0);
    expect(fingerprintCalls).toBe(0);
    expect(env.sent.filter((m) => m.message.type === 'protect-input')).toEqual([]);
    expect(session.snapshot().hasSalt).toBe(false);
    // The tab is still armed on focus (no value involved).
    expect(env.sent.some((m) => m.message.type === 'protect-arm')).toBe(true);
  });

  it('a salt arriving later (value-match turned on) re-reads the tracked field once', async () => {
    const env = new FakeProtectEnv();
    let withSalt = false;
    env.respond = () => (withSalt ? ack() : ack({ saltId: undefined, salt: undefined }));
    const session = new ProtectSession(env, { fingerprints: () => [{ enc: 'plain', len: 3, h: '0123456789abc' }] });
    session.start();
    await settle();
    const el = input({ type: 'email', name: 'email' });
    env.fire('focusin', el);
    el.type(CANARY);
    env.fire('input', el);
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.reads).toBe(0);
    withSalt = true;
    await vi.advanceTimersByTimeAsync(20_000);
    env.fire('focusin', el); // protect-arm, answered with the salt
    await settle();
    expect(el.reads).toBe(1);
    expect(env.sent.filter((m) => m.message.type === 'protect-input')).toHaveLength(1);
    expect(JSON.stringify(env.sent)).not.toContain(CANARY);
  });

  it('a hello answered without a salt (value-match turned off, SW re-key) drops the salt: no read afterwards', async () => {
    const env = new FakeProtectEnv();
    let withSalt = true;
    env.respond = () => (withSalt ? ack() : ack({ saltId: undefined, salt: undefined }));
    const session = new ProtectSession(env, { fingerprints: () => [{ enc: 'plain', len: 3, h: '0123456789abc' }] });
    session.start();
    await settle();
    const el = input({ type: 'email', name: 'email' });
    env.fire('focusin', el);
    el.type(CANARY);
    env.fire('input', el);
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.reads).toBe(1);
    expect(session.snapshot().hasSalt).toBe(true);
    withSalt = false;
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'rekey' });
    await settle();
    expect(session.snapshot()).toMatchObject({ state: 'active', hasSalt: false, pendingFields: 0 });
    el.type(CANARY + 'x');
    env.fire('input', el);
    await vi.advanceTimersByTimeAsync(1000);
    env.fire('focusout', el);
    await settle();
    expect(el.reads).toBe(1);
    expect(env.sent.filter((m) => m.message.type === 'protect-input')).toHaveLength(1);
  });
});
