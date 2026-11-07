// ADR-020 §F, REQ-010 (S10): the module's MAIN part never makes a network call of its own. With spies on every network
// API of the fake realm, the number of calls equals exactly what the page did, through install, observation, relay
// handshake, flushes, pause / resume and stop; the only thing the module posts is window.postMessage on its channel.

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, PROTECT_CHANNEL, PROTECT_MAIN_PROTOCOL_VERSION } from '@detect-expert/contracts';
import { installProtectMain } from '../src/protect/index';
import { PROTECT_HOOK_CANDIDATE } from '../src/protect/config';
import { deliver, makeEnv } from './helpers';
import { makeRealm, withoutPrepareStackTrace } from './protect-fakes';

describe('protect MAIN: no egress of its own', () => {
  it('network API calls equal the page calls; constructors of other network APIs are never used', () => {
    const fr = makeRealm();
    const constructed: string[] = [];
    for (const name of ['WebSocket', 'EventSource', 'Image', 'RTCPeerConnection', 'WebTransport', 'Worker', 'SharedWorker']) {
      Object.defineProperty(fr.realm, name, {
        value: function NetworkApi() {
          constructed.push(name);
        },
        writable: true,
        configurable: true,
      });
    }
    const fake = makeEnv();
    const handle = installProtectMain(fr.realm, { groups: 3, earlyCapture: true }, { env: fake.env, docHost: 'shop.example.com', config: { ...PROTECT_HOOK_CANDIDATE, imgSrc: 'wrap' } });
    expect(handle).not.toBeNull();
    const id = handle!.runtime.sensorBootId;
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-hello', protocolVersion: PROTECT_MAIN_PROTOCOL_VERSION, relaySessionId: 'r1', paused: false });
    const page = { fetch: 0, xhrOpen: 0, xhrSend: 0, beacon: 0, imgSrc: 0 };
    withoutPrepareStackTrace(() => {
      for (let i = 0; i < 25; i++) {
        fr.runAs('https://cdn.example.org/a.js', 'realm.fetch("https://collect.example.net/" + i);', { realm: fr.realm, i });
        page.fetch++;
        const xhr = fr.newXhr() as Record<string, (...a: unknown[]) => unknown>;
        xhr['open']!('POST', '/api');
        xhr['send']!('body');
        page.xhrOpen++;
        page.xhrSend++;
        ((fr.realm as unknown as { navigator: Record<string, (...a: unknown[]) => unknown> }).navigator)['sendBeacon']!('https://b.example.net/', 'd');
        page.beacon++;
        (fr.newImage() as { src: string }).src = 'https://p.example.net/p.gif';
        page.imgSrc++;
        fake.advance(PROTECT_BUDGETS.flushMs);
      }
    });
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-pause' });
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-resume' });
    fake.advance(5000);
    deliver(fake, { channel: PROTECT_CHANNEL, sensorBootId: id, type: 'protect-relay-stop', reason: 'revoked' });
    fake.advance(5000);
    expect({ fetch: fr.calls.fetch, xhrOpen: fr.calls.xhrOpen, xhrSend: fr.calls.xhrSend, beacon: fr.calls.beacon, imgSrc: fr.calls.imgSrc }).toEqual(page);
    expect(constructed).toEqual([]);
    expect(fr.calls.valueReads).toBe(0);
    // Everything the module emitted went through the realm's postMessage on its own channel.
    expect(fake.posted.length).toBeGreaterThan(1);
    for (const m of fake.posted) expect((m as { channel?: unknown }).channel).toBe(PROTECT_CHANNEL);
    // After stop the page's calls still reach the originals exactly once (hooks restored).
    (fr.realm as unknown as { fetch: (u: string) => unknown }).fetch('https://after.example.net/');
    expect(fr.calls.fetch).toBe(page.fetch + 1);
  });
});
