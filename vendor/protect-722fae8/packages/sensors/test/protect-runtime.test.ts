// ADR-020 §F (S10): ProtectMainRuntime — relay handshake on the module channel (FOLLOWUPS 93: an unbound relay hello
// repeats the MAIN hello), batches ≤ 32 items and ≤ 16 KiB validated by the contracts, flush every 250 ms, startup
// queue 32, ≤ 64 registration keys, overflow -> dropped + budget-exceeded, pause / resume / stop with ownership-checked
// restore (REQ-012), installProtectMain on a fake realm.

import { describe, expect, it } from 'vitest';
import { BUDGETS, PROTECT_BUDGETS, PROTECT_CHANNEL, PROTECT_MAIN_PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, jsonLengthUpTo, templateScriptPath, validateProtectMainMessage } from '@detect-expert/contracts';
import type { ProtectMainBatchMessage, ProtectMainMessage, ScriptRef } from '@detect-expert/contracts';
import { wrapMethod } from '../src/wrap';
import { HOOK_LISTEN, HOOK_OBSERVE, ProtectMainRuntime, TARGET_INDEX } from '../src/protect/runtime';
import { installProtectMain } from '../src/protect/index';
import { PROTECT_HOOK_CANDIDATE } from '../src/protect/config';
import { deliver, makeEnv } from './helpers';
import { makeRealm, withoutPrepareStackTrace } from './protect-fakes';

type Fake = ReturnType<typeof makeEnv>;

function mainMessages(fake: Fake): ProtectMainMessage[] {
  return fake.posted.map((m) => {
    const r = validateProtectMainMessage(m);
    if (!r.ok) throw new Error('invalid MAIN message: ' + r.reason);
    return r.value;
  });
}

function batches(fake: Fake): ProtectMainBatchMessage[] {
  return mainMessages(fake).filter((m): m is ProtectMainBatchMessage => m.type === 'protect-main-batch');
}

function relayHello(sensorBootId: string, paused = false): Record<string, unknown> {
  return { channel: PROTECT_CHANNEL, sensorBootId, type: 'protect-relay-hello', protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION, relaySessionId: 'relay-1', paused };
}

function started(): { fake: Fake; runtime: ProtectMainRuntime } {
  const fake = makeEnv();
  const runtime = new ProtectMainRuntime(fake.env, { groups: 3, startedLate: false });
  runtime.start();
  return { fake, runtime };
}

const EXTERNAL: ScriptRef = { kind: 'external', scheme: 'https', host: 'cdn.example.org', pathTemplate: '/a.js' };

describe('handshake', () => {
  it('announces itself; an unbound relay hello repeats the hello; the bound hello completes the handshake', () => {
    const { fake, runtime } = started();
    expect(mainMessages(fake)).toEqual([{ channel: PROTECT_CHANNEL, sensorBootId: runtime.sensorBootId, type: 'protect-main-hello', protocolVersion: 1, startedLate: false, groups: 3 }]);
    expect(runtime.sensorBootId).toMatch(/^boot-[0-9a-f]{24}$/);
    deliver(fake, relayHello(UNBOUND_SENSOR_BOOT_ID));
    expect(mainMessages(fake).filter((m) => m.type === 'protect-main-hello')).toHaveLength(2);
    runtime.noteSend('send-fetch', EXTERNAL, true, { kind: 'absolute', host: 'collect.example.net' });
    fake.advance(1000);
    expect(batches(fake)).toEqual([]); // nothing before the handshake
    deliver(fake, relayHello(runtime.sensorBootId));
    expect(runtime.snapshot().handshake).toBe(true);
    expect(batches(fake)).toHaveLength(1);
    expect(batches(fake)[0]!.sends[0]).toMatchObject({ hookPoint: 'send-fetch', sensorSeq: 1, script: EXTERNAL, sampled: true });
    // Hostile / foreign messages are ignored: another boot, another source, another channel.
    deliver(fake, { ...relayHello('boot-other'), type: 'protect-relay-stop', reason: 'revoked' });
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: runtime.sensorBootId, type: 'protect-relay-stop', reason: 'revoked' }, { other: 'window' });
    deliver(fake, { channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId, type: 'bridge-stop', reason: 'revoked' });
    expect(runtime.snapshot().state).toBe('running');
  });

  it('a relay hello with another protocol version is not a handshake', () => {
    const { fake, runtime } = started();
    deliver(fake, { ...relayHello(runtime.sensorBootId), protocolVersion: 2 });
    expect(runtime.snapshot().handshake).toBe(false);
  });
});

describe('batches and budgets', () => {
  it('send samples: per-sample sequence, tMs multiple of 10, ≤ 32 items per batch, flush every 250 ms', () => {
    const { fake, runtime } = started();
    deliver(fake, relayHello(runtime.sensorBootId));
    for (let i = 0; i < 40; i++) {
      runtime.noteSend('send-beacon', i % 2 === 0 ? EXTERNAL : { kind: 'unknown' }, i % 2 === 0, { kind: 'relative' });
      if (i === 20) fake.advance(PROTECT_BUDGETS.flushMs);
    }
    fake.advance(PROTECT_BUDGETS.flushMs);
    const all = batches(fake);
    const sends = all.flatMap((b) => b.sends);
    expect(sends.map((s) => s.sensorSeq)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    for (const b of all) {
      expect(b.sends.length + b.registrations.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxItemsPerBatch);
      expect(jsonLengthUpTo(b, BUDGETS.maxBatchBytes)).toBeLessThanOrEqual(BUDGETS.maxBatchBytes);
    }
    expect(all.map((b) => b.sensorSeq)).toEqual(all.map((_, i) => i + 1));
    expect(sends.every((s) => s.tMs % 10 === 0)).toBe(true);
  });

  it('startup queue: at most 32 pending sends; the rest is dropped with budget-exceeded (sequence still advances)', () => {
    const { fake, runtime } = started();
    for (let i = 0; i < 40; i++) runtime.noteSend('send-fetch', EXTERNAL, i < 36, { kind: 'unread' });
    expect(runtime.snapshot()).toMatchObject({ pendingSends: 32, sendSeq: 40, dropped: { sends: 4, unsampled: 4 } });
    deliver(fake, relayHello(runtime.sensorBootId));
    const all = batches(fake);
    expect(all[0]!.dropped).toEqual({ sends: 4, registrations: 0, unsampled: 4 });
    expect(all[0]!.limitations).toContain('budget-exceeded');
    expect(all.flatMap((b) => b.sends)).toHaveLength(32);
  });

  it('long hosts and paths still fit 16 KiB per batch (estimated from lengths, never serialized)', () => {
    const { fake, runtime } = started();
    deliver(fake, relayHello(runtime.sensorBootId));
    const host = Array.from({ length: 4 }, (_, i) => 'l'.repeat(60) + i).join('.') + '.org';
    const segment = 'p'.repeat(20) + '.' + 'q'.repeat(18);
    const ref: ScriptRef = { kind: 'external', scheme: 'https', host, pathTemplate: '/' + segment + '/' + segment };
    expect(templateScriptPath(ref.pathTemplate!)).toBe(ref.pathTemplate);
    for (let i = 0; i < 32; i++) runtime.noteSend('send-fetch', ref, true, { kind: 'absolute', host });
    fake.advance(PROTECT_BUDGETS.flushMs);
    const all = batches(fake);
    expect(all.length).toBeGreaterThan(1);
    for (const b of all) expect(jsonLengthUpTo(b, BUDGETS.maxBatchBytes)).toBeLessThanOrEqual(BUDGETS.maxBatchBytes);
    expect(all.flatMap((b) => b.sends)).toHaveLength(32);
  });

  it('registrations fold into ≤ 64 keys with saturating counts since the last flush', () => {
    const { fake, runtime } = started();
    deliver(fake, relayHello(runtime.sensorBootId));
    const id = runtime.internScript(EXTERNAL);
    expect(runtime.internScript({ ...EXTERNAL })).toBe(id);
    expect(runtime.internScript({ kind: 'unknown' })).toBe(0);
    for (let i = 0; i < 5; i++) runtime.noteRegistration(HOOK_LISTEN, 0, TARGET_INDEX.document, id, true);
    runtime.noteRegistration(HOOK_OBSERVE, -1, TARGET_INDEX.root, -1, false);
    fake.advance(PROTECT_BUDGETS.flushMs);
    expect(batches(fake).flatMap((b) => b.registrations)).toEqual([
      expect.objectContaining({ hookPoint: 'listen', eventCode: 'input', targetKind: 'document', script: EXTERNAL, sampled: true, count: 5 }),
      expect.objectContaining({ hookPoint: 'observe-document', targetKind: 'root', script: { kind: 'unknown' }, sampled: false, count: 1 }),
    ]);
    runtime.noteRegistration(HOOK_LISTEN, 0, TARGET_INDEX.document, id, true);
    fake.advance(PROTECT_BUDGETS.flushMs);
    expect(batches(fake).at(-1)!.registrations).toEqual([expect.objectContaining({ count: 1 })]);
    // 64 keys per realm: the 65th distinct key is dropped.
    for (let ev = 0; ev < 18; ev++) for (let t = 0; t < 4; t++) runtime.noteRegistration(HOOK_LISTEN, ev, t, 0, false);
    expect(runtime.snapshot().registrationKeys).toBe(PROTECT_BUDGETS.maxRegistrationKeysPerRealm);
    expect(runtime.snapshot().dropped.registrations).toBeGreaterThan(0);
    expect(runtime.snapshot().limitations).toContain('budget-exceeded');
    fake.advance(PROTECT_BUDGETS.flushMs * 4);
    for (const b of batches(fake)) expect(b.sends.length + b.registrations.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxItemsPerBatch);
  });
});

describe('pause, resume, stop', () => {
  it('pause disables the observers and posts nothing; resume flushes; stop restores only owned hooks', () => {
    const { fake, runtime } = started();
    deliver(fake, relayHello(runtime.sensorBootId));
    const ownedTarget = { m(): number { return 1; } };
    const replacedTarget = { m(): number { return 2; } };
    const observed: number[] = [];
    runtime.attach([
      wrapMethod(ownedTarget, 'm', () => observed.push(1), { context: runtime.hooks }),
      wrapMethod(replacedTarget, 'm', () => observed.push(2), { context: runtime.hooks }),
    ]);
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: runtime.sensorBootId, type: 'protect-relay-pause' });
    expect(ownedTarget.m()).toBe(1);
    expect(observed).toEqual([]);
    runtime.noteSend('send-fetch', EXTERNAL, true, { kind: 'relative' });
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: runtime.sensorBootId, type: 'protect-relay-resume' });
    fake.advance(PROTECT_BUDGETS.flushMs);
    expect(batches(fake).flatMap((b) => b.sends)).toHaveLength(1);
    const page = (): number => 3;
    replacedTarget.m = page;
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: runtime.sensorBootId, type: 'protect-relay-stop', reason: 'revoked' });
    const snap = runtime.snapshot();
    expect(snap.state).toBe('stopped');
    expect(Object.getOwnPropertyDescriptor(ownedTarget, 'm')?.value.name).toBe('m');
    expect(replacedTarget.m).toBe(page);
    expect(runtime.stop('local')).toMatchObject({ reason: 'revoked', restored: ['m'], notRestored: ['m'], cleanup: 'partial' });
    expect(fake.listenerCount('message')).toBe(0);
    const count = fake.posted.length;
    runtime.noteSend('send-fetch', EXTERNAL, true, { kind: 'relative' });
    fake.advance(1000);
    expect(fake.posted.length).toBe(count);
  });
});

describe('installProtectMain', () => {
  it('installs the hooks of the enabled groups, starts the runtime and relays real samples', () => {
    const fr = makeRealm();
    const fake = makeEnv();
    const handle = installProtectMain(fr.realm, { groups: 3, earlyCapture: true }, { env: fake.env, docHost: 'shop.example.com', config: PROTECT_HOOK_CANDIDATE });
    expect(handle).not.toBeNull();
    expect(handle!.snapshot().hooks).toBe(6);
    deliver(fake, relayHello(handle!.runtime.sensorBootId));
    withoutPrepareStackTrace(() => {
      fr.runAs('https://cdn.tracker-a.example.org/t.js', 'realm.fetch("https://collect.example.net/x"); realm.document.addEventListener("input", () => 0);', { realm: fr.realm });
    });
    fake.advance(PROTECT_BUDGETS.flushMs);
    const b = batches(fake);
    expect(b.flatMap((x) => x.sends)).toMatchObject([{ hookPoint: 'send-fetch', script: { kind: 'external', host: 'cdn.tracker-a.example.org', pathTemplate: '/t.js' } }]);
    expect(b.flatMap((x) => x.registrations)).toMatchObject([{ hookPoint: 'listen', eventCode: 'input', targetKind: 'document' }]);
    expect(handle!.stop().cleanup).toBe('complete');
  });

  it('installs nothing for a late start, no group, or a configuration with every hook off', () => {
    const late = makeEnv({ startedLate: true });
    expect(installProtectMain(makeRealm().realm, { groups: 3, earlyCapture: true }, { env: late.env, docHost: '' })).toBeNull();
    expect(late.posted).toEqual([]);
    expect(installProtectMain(makeRealm().realm, { groups: 3, earlyCapture: false }, { env: makeEnv().env, docHost: '' })).toBeNull();
    expect(installProtectMain(makeRealm().realm, { groups: 0, earlyCapture: true }, { env: makeEnv().env, docHost: '' })).toBeNull();
    const fr = makeRealm();
    const fake = makeEnv();
    expect(installProtectMain(fr.realm, { groups: 3, earlyCapture: true }, { env: fake.env, docHost: '', config: { listen: 'off', send: 'off', observe: 'off', imgSrc: 'off' } })).toBeNull();
    expect(fake.posted).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(fr.realm, 'fetch')?.value.name).toBe('fetchImpl');
  });

  it('only the groups of the prelude mask: send (bit 0) without listen (bit 1)', () => {
    const fr = makeRealm();
    const handle = installProtectMain(fr.realm, { groups: 1, earlyCapture: true }, { env: makeEnv().env, docHost: '', config: PROTECT_HOOK_CANDIDATE });
    expect(handle!.snapshot().hooks).toBe(4);
    const proto = (fr.realm as unknown as { EventTarget: { prototype: object } }).EventTarget.prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'addEventListener')?.value.name).toBe('addEventListener');
  });
});
