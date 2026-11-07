// ADR-020 §A, §4, §8 (S05): ISOLATED session of the module «Защита». Nothing is read before an active ack; trusted
// events only; debounce; ≤ 8 tracked fields; ≤ 4 fields per message and ≤ 4 messages/s; submit after the values;
// rekey re-reads once; stop removes every listener; no retry after a failed sendMessage. Fingerprints are injected
// (the engine stub of S07 returns none), so the message shapes can be checked; values never appear in messages.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTECT_BUDGETS, validateProtectPageMessage } from '@detect-expert/contracts';
import type { FieldKind, ProtectFingerprintEntry } from '@detect-expert/contracts';
import { ProtectSession, fnv1a32 } from '../src/protect/session';
import type { ProtectSessionOptions } from '../src/protect/session';
import { FakeButton, FakeForm, FakeProtectEnv, SALT, SALT_2, SALT_ID, SALT_ID_2, ack, input, settle } from './protect-fakes';
import type { FakeField } from './protect-fakes';

const CANARY_EMAIL = 'CANARY-EMAIL-7c1d@example.test';

interface Harness {
  env: FakeProtectEnv;
  session: ProtectSession;
  fingerprintCalls: Array<{ kind: FieldKind; salt: string }>;
  events: string[];
}

/** One fake fingerprint per value (the real engine function arrives with S07); never derived from the value text. */
function fakeEntries(): ProtectFingerprintEntry[] {
  return [{ enc: 'plain', len: 12, h: '0123456789abc' }];
}

async function started(options: { respond?: FakeProtectEnv['respond']; ready?: string; extra?: ProtectSessionOptions } = {}): Promise<Harness> {
  const env = new FakeProtectEnv();
  if (options.respond !== undefined) env.respond = options.respond;
  if (options.ready !== undefined) env.ready = options.ready;
  const fingerprintCalls: Array<{ kind: FieldKind; salt: string }> = [];
  const events: string[] = [];
  const session = new ProtectSession(env, {
    fingerprints: (kind, _typed, salt) => {
      fingerprintCalls.push({ kind, salt });
      return fakeEntries();
    },
    onActive: (groups) => events.push('active:' + String(groups)),
    onPause: (paused) => events.push(paused ? 'pause' : 'resume'),
    onStop: () => events.push('stop'),
    ...options.extra,
  });
  session.start();
  await settle();
  return { env, session, fingerprintCalls, events };
}

function typeInto(env: FakeProtectEnv, el: FakeField, text: string, trusted = true): void {
  env.fire('focusin', el, trusted);
  el.type(text);
  env.fire('input', el, trusted);
}

function email(): FakeField {
  return input({ type: 'email', name: 'email' });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hello and ack', () => {
  it('sends protect-hello first; startedLate follows document.readyState', async () => {
    const early = await started();
    expect(early.env.sent.map((s) => s.message)).toEqual([{ schemaVersion: 1, type: 'protect-hello', startedLate: false }]);
    const late = await started({ ready: 'interactive' });
    expect(late.env.messages('protect-hello')).toEqual([{ schemaVersion: 1, type: 'protect-hello', startedLate: true }]);
    expect(early.events).toEqual(['active:3']);
  });

  it('nothing is read before the active ack: input before the answer only marks the field', async () => {
    const env = new FakeProtectEnv();
    let release: (value: unknown) => void = () => undefined;
    env.respond = () => new Promise((resolve) => (release = resolve));
    const session = new ProtectSession(env, { fingerprints: () => fakeEntries() });
    session.start();
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.reads).toBe(0);
    expect(session.snapshot()).toMatchObject({ state: 'starting', dirtyFields: 1 });
    release(ack());
    await settle();
    await vi.advanceTimersByTimeAsync(PROTECT_BUDGETS.inputDebounceMs);
    expect(el.reads).toBe(1);
  });

  it('ack active:false -> full stop: listeners removed, no reads, no messages afterwards', async () => {
    const { env, session, events } = await started({ respond: () => ack({ active: false, groups: 0, saltId: undefined, salt: undefined }) });
    expect(session.snapshot().state).toBe('stopped');
    expect(env.listenerCount()).toBe(0);
    expect(events).toEqual(['stop']);
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    await vi.advanceTimersByTimeAsync(2000);
    expect(el.reads).toBe(0);
    expect(env.sent).toHaveLength(1);
  });

  it('an invalid answer or a failed hello fails closed (stop, no retry)', async () => {
    const invalid = await started({ respond: () => ({ type: 'protect-ack', active: true }) });
    expect(invalid.session.snapshot().state).toBe('stopped');
    const failed = await started({
      respond: () => {
        throw new Error('Could not establish connection');
      },
    });
    expect(failed.session.snapshot().state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(5000);
    expect(failed.env.sent).toHaveLength(1);
  });

  it('review r2: a prerendered document says hello only once it is shown; a stop before that removes the wait', async () => {
    class PrerenderEnv extends FakeProtectEnv {
      prerender = true;
      waiting: Array<() => void> = [];
      prerendering(): boolean {
        return this.prerender;
      }
      onActivation(callback: () => void): () => void {
        this.waiting.push(callback);
        return () => {
          this.waiting = this.waiting.filter((c) => c !== callback);
        };
      }
      activate(): void {
        this.prerender = false;
        for (const c of this.waiting.splice(0)) c();
      }
    }
    const env = new PrerenderEnv();
    const session = new ProtectSession(env, { fingerprints: () => fakeEntries() });
    session.start();
    await settle();
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent).toHaveLength(0);
    expect(el.reads).toBe(0);
    expect(session.snapshot()).toMatchObject({ state: 'starting', dirtyFields: 1 });
    env.activate();
    await settle();
    expect(env.messages('protect-hello')).toEqual([{ schemaVersion: 1, type: 'protect-hello', startedLate: false }]);
    expect(session.snapshot().state).toBe('active');
    env.waiting.push(() => undefined);
    env.activate();
    await settle();
    expect(env.messages('protect-hello')).toHaveLength(1);

    const early = new PrerenderEnv();
    const stopped = new ProtectSession(early, { fingerprints: () => fakeEntries() });
    stopped.start();
    expect(early.waiting).toHaveLength(1);
    stopped.stop();
    expect(early.waiting).toHaveLength(0);
    early.activate();
    await settle();
    expect(early.sent).toHaveLength(0);

    const broken = new PrerenderEnv();
    broken.prerendering = () => {
      throw new Error('no document');
    };
    new ProtectSession(broken, { fingerprints: () => fakeEntries() }).start();
    await settle();
    expect(broken.messages('protect-hello')).toHaveLength(1);
  });
});

describe('trusted events, arming and debounce', () => {
  it('untrusted events are ignored entirely', async () => {
    const { env, session } = await started();
    const el = email();
    typeInto(env, el, CANARY_EMAIL, false);
    env.fire('focusout', el, false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(el.reads).toBe(0);
    expect(env.messages('protect-arm')).toEqual([]);
    expect(session.snapshot().trackedFields).toBe(0);
  });

  it('focusin on a tracked field arms at most once per armThrottleMs', async () => {
    const { env } = await started();
    const el = email();
    env.fire('focusin', el);
    env.fire('focusin', el);
    expect(env.messages('protect-arm')).toEqual([{ schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' }]);
    vi.advanceTimersByTime(PROTECT_BUDGETS.armThrottleMs);
    env.fire('focusin', input({ type: 'tel' }));
    expect(env.messages('protect-arm').map((m) => m.fieldKind)).toEqual(['email', 'phone']);
    expect(el.reads).toBe(0); // focus alone never reads
  });

  it('input is debounced: one read inputDebounceMs after the last keystroke, then protect-input', async () => {
    const { env, fingerprintCalls } = await started();
    const el = email();
    env.fire('focusin', el);
    for (const text of ['C', 'CA', CANARY_EMAIL]) {
      el.type(text);
      env.fire('input', el);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(el.reads).toBe(0);
    await vi.advanceTimersByTimeAsync(PROTECT_BUDGETS.inputDebounceMs);
    expect(el.reads).toBe(1);
    expect(fingerprintCalls).toEqual([{ kind: 'email', salt: SALT }]);
    const inputs = env.messages('protect-input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      schemaVersion: 1,
      type: 'protect-input',
      saltId: SALT_ID,
      seq: 1,
      fields: [{ fieldRef: 1, fieldKind: 'email', trigger: 'input', entries: fakeEntries() }],
      submit: 'none',
      neverReadFields: 0,
      paymentSuspended: false,
    });
    expect(validateProtectPageMessage(inputs[0]).ok).toBe(true);
    expect(JSON.stringify(env.sent)).not.toContain(CANARY_EMAIL);
  });

  it('focusout of a dirty field reads at once (trigger blur); an unchanged value is not sent again (FNV dedup)', async () => {
    const { env } = await started();
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(1);
    await settle();
    expect(env.messages('protect-input').map((m) => m.fields[0]?.trigger)).toEqual(['blur']);
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(2);
    expect(env.messages('protect-input')).toHaveLength(1);
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('without fingerprints (the S07 stub) or without a salt nothing about the value is sent', async () => {
    const env = new FakeProtectEnv();
    const session = new ProtectSession(env, { fingerprints: () => [] });
    session.start();
    await settle();
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(1);
    expect(env.messages('protect-input')).toEqual([]);
    const noSalt = new FakeProtectEnv();
    noSalt.respond = () => ack({ saltId: undefined, salt: undefined });
    const s2 = new ProtectSession(noSalt, { fingerprints: () => fakeEntries() });
    s2.start();
    await settle();
    const el2 = email();
    typeInto(noSalt, el2, CANARY_EMAIL);
    noSalt.fire('focusout', el2);
    noSalt.fire('submit', new FakeForm());
    expect(noSalt.messages('protect-input')).toEqual([]);
  });
});

describe('never-read fields and payment', () => {
  it('password, one-time code and «show password» fields are counted, never read', async () => {
    const { env, session } = await started();
    const pw = input({ type: 'password', autocomplete: 'current-password' }, true);
    env.watch(pw);
    typeInto(env, pw, 'CANARY-PASSWORD-7e2b');
    pw.setAttribute('type', 'text'); // «show password»
    typeInto(env, pw, 'CANARY-PASSWORD-7e2b-more');
    env.deliverMutations();
    env.fire('focusout', pw);
    const otp = input({ type: 'text', autocomplete: 'one-time-code' }, true);
    typeInto(env, otp, '123456');
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    await settle();
    expect(pw.reads).toBe(0);
    expect(otp.reads).toBe(0);
    expect(session.snapshot()).toMatchObject({ neverReadFields: 2, trackedFields: 1 });
    expect(env.messages('protect-input').at(-1)).toMatchObject({ neverReadFields: 2, paymentSuspended: false });
    expect(JSON.stringify(env.sent)).not.toContain('CANARY-PASSWORD');
  });

  it('a field that becomes a password after tracking is never read again', async () => {
    const { env } = await started();
    const el = input({ type: 'email', name: 'email' });
    env.watch(el);
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(1);
    el.setAttribute('type', 'password');
    el.type('CANARY-PASSWORD-7e2b');
    env.fire('input', el);
    el.setAttribute('type', 'email');
    env.fire('focusout', el);
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.reads).toBe(1);
  });

  it('a payment control focused in the document suspends every read (paymentSuspended)', async () => {
    const { env, session } = await started();
    env.fire('focusin', input({ type: 'text', autocomplete: 'cc-number' }, true));
    const el = input({ type: 'email', name: 'email' }, true);
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    await settle();
    expect(el.reads).toBe(0);
    expect(session.snapshot().paymentSuspended).toBe(true);
    expect(env.messages('protect-input').at(-1)).toMatchObject({ paymentSuspended: true, fields: [] });
  });

  it('a payment control found by the document scan (never focused) suspends the read as well', async () => {
    const { env } = await started();
    env.controls.push(input({ type: 'text', name: 'card-number' }));
    const el = input({ type: 'email', name: 'email' }, true);
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(0);
  });
});

describe('bounds', () => {
  it('at most maxTrackedFieldsPerDocument fields (fieldRef 1..8)', async () => {
    const { env, session } = await started();
    const fields = Array.from({ length: 10 }, () => email());
    fields.forEach((el, i) => typeInto(env, el, 'user' + String(i) + '@example.test'));
    await vi.advanceTimersByTimeAsync(PROTECT_BUDGETS.inputDebounceMs);
    expect(session.snapshot().trackedFields).toBe(PROTECT_BUDGETS.maxTrackedFieldsPerDocument);
    expect(fields.slice(0, 8).every((el) => el.reads === 1)).toBe(true);
    expect(fields.slice(8).every((el) => el.reads === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    const refs = env.messages('protect-input').flatMap((m) => m.fields.map((f) => f.fieldRef));
    expect([...refs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('≤ 4 fields per protect-input and ≤ 4 protect-input per second; every message validates', async () => {
    const { env } = await started();
    for (let round = 0; round < 6; round++) {
      const fields = Array.from({ length: 2 }, () => email());
      for (const [i, el] of fields.entries()) {
        typeInto(env, el, 'r' + String(round) + 'u' + String(i) + '@example.test');
        env.fire('focusout', el);
      }
    }
    const inputs = env.sent.filter((s) => s.message.type === 'protect-input');
    for (const s of inputs) {
      const m = s.message as { fields: unknown[] };
      expect(m.fields.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxFieldsPerInputMessage);
      expect(validateProtectPageMessage(s.message).ok).toBe(true);
    }
    const windowStart = inputs[0]!.at;
    expect(inputs.filter((s) => s.at - windowStart < 1000).length).toBeLessThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(3000);
    const all = env.sent.filter((s) => s.message.type === 'protect-input');
    for (let i = 4; i < all.length; i++) expect(all[i]!.at - all[i - 4]!.at).toBeGreaterThanOrEqual(1000);
  });
});

describe('submit boundaries', () => {
  it('submit: values first (trigger submit), the boundary rides on the last message', async () => {
    const { env } = await started();
    const fields = Array.from({ length: 6 }, () => email());
    fields.forEach((el, i) => typeInto(env, el, 'user' + String(i) + '@example.test'));
    env.fire('submit', new FakeForm());
    await vi.advanceTimersByTimeAsync(2000);
    const inputs = env.messages('protect-input');
    expect(inputs.map((m) => m.fields.length)).toEqual([4, 2]);
    expect(inputs.map((m) => m.submit)).toEqual(['none', 'submit-event']);
    expect(inputs.flatMap((m) => m.fields.map((f) => f.trigger))).toEqual(Array(6).fill('submit'));
  });

  it('a click on a submit control inside a form -> submit-control, at most once per second; outside a form nothing', async () => {
    const { env } = await started();
    const form = new FakeForm();
    env.fire('click', new FakeButton(null));
    expect(env.messages('protect-input')).toEqual([]);
    env.fire('click', new FakeButton(form));
    env.fire('click', new FakeButton(form));
    await settle();
    expect(env.messages('protect-input').map((m) => m.submit)).toEqual(['submit-control']);
    vi.advanceTimersByTime(1000);
    env.fire('click', new FakeButton(form));
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.messages('protect-input').map((m) => m.submit)).toEqual(['submit-control', 'submit-control']);
  });

  it('pagehide flushes the pending debounce', async () => {
    const { env } = await started();
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('pagehide', null);
    expect(el.reads).toBe(1);
  });
});

describe('SW control', () => {
  it('rekey: the same hello again, the new salt, then every field still in the DOM is read once (trigger rekey)', async () => {
    let salt = { saltId: SALT_ID, salt: SALT };
    const { env, fingerprintCalls } = await started({ respond: () => ack(salt) });
    const kept = email();
    const removed = email();
    typeInto(env, kept, 'kept@example.test');
    typeInto(env, removed, 'removed@example.test');
    env.fire('focusout', kept);
    env.fire('focusout', removed);
    removed.isConnected = false;
    salt = { saltId: SALT_ID_2, salt: SALT_2 };
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'rekey' });
    await settle();
    expect(env.messages('protect-hello')).toEqual([
      { schemaVersion: 1, type: 'protect-hello', startedLate: false },
      { schemaVersion: 1, type: 'protect-hello', startedLate: false },
    ]);
    expect([kept.reads, removed.reads]).toEqual([2, 1]);
    expect(fingerprintCalls.at(-1)).toEqual({ kind: 'email', salt: SALT_2 });
    await vi.advanceTimersByTimeAsync(1000);
    const last = env.messages('protect-input').at(-1)!;
    expect(last.saltId).toBe(SALT_ID_2);
    expect(last.fields).toEqual([{ fieldRef: 1, fieldKind: 'email', trigger: 'rekey', entries: fakeEntries() }]);
  });

  it('control from anything but the own SW, or malformed, is ignored', async () => {
    const { env, session } = await started();
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'stop' }, false);
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'halt' });
    env.control({ schemaVersion: 1, type: 'bridge-control', command: 'stop' });
    expect(session.snapshot().state).toBe('active');
  });

  it('pause stops reading until resume; stop removes every listener', async () => {
    const { env, session, events } = await started();
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'pause' });
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(0);
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'resume' });
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    expect(el.reads).toBe(1);
    env.control({ schemaVersion: 1, type: 'protect-control', command: 'stop' });
    expect(session.snapshot().state).toBe('stopped');
    expect(env.listenerCount()).toBe(0);
    expect(events).toEqual(['active:3', 'pause', 'resume', 'stop']);
  });

  it('an inactive answer to a later message (protect-arm / protect-input) stops the session', async () => {
    let active = true;
    const { env, session } = await started({ respond: () => (active ? ack() : ack({ active: false, groups: 0, saltId: undefined, salt: undefined })) });
    active = false;
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    await settle();
    expect(session.snapshot().state).toBe('stopped');
  });

  it('a failed sendMessage is not retried; a dead context stops the session', async () => {
    let fail = false;
    const { env, session } = await started({
      respond: () => {
        if (fail) throw new Error('Could not establish connection');
        return ack();
      },
    });
    fail = true;
    const el = email();
    typeInto(env, el, CANARY_EMAIL);
    env.fire('focusout', el);
    await vi.advanceTimersByTimeAsync(5000);
    // protect-arm and protect-input failed once each; neither was sent again.
    expect(env.messages('protect-arm')).toHaveLength(1);
    expect(env.messages('protect-input')).toHaveLength(1);
    expect(session.snapshot()).toMatchObject({ state: 'active', sendFailures: 2 });
    env.alive = false;
    typeInto(env, el, 'other@example.test');
    env.fire('focusout', el);
    await settle();
    expect(session.snapshot().state).toBe('stopped');
  });
});
