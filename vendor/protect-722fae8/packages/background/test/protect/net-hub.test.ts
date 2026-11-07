import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { RequestDetailsLike } from '../../src/chrome-api';
import { NetHub, fastHost, needsSharedListeners } from '../../src/protect/net-hub';
import type { NetHubSink, ProtectRequestContext } from '../../src/protect/net-hub';
import { ProtectTabModel } from '../../src/protect/tab-model';
import { committed, createFakeChrome } from '../fake-chrome';
import { makeClock } from './support';

function setup(granted: (host: string) => boolean = () => true) {
  const fake = createFakeChrome();
  const clock = makeClock();
  const tabs = new ProtectTabModel(clock);
  const seen: Array<{ hook: string; tabId: number; resolved?: ProtectRequestContext['resolved'] }> = [];
  const evicted: number[] = [];
  const sink: NetHubSink = {
    onRequest: (d, r) => seen.push({ hook: 'request', tabId: d.tabId, resolved: r.resolved }),
    onSendHeaders: (d) => seen.push({ hook: 'send', tabId: d.tabId }),
    onErrorOccurred: (d) => seen.push({ hook: 'error', tabId: d.tabId }),
    onCompleted: (d) => seen.push({ hook: 'completed', tabId: d.tabId }),
    onArmEvicted: (tabId) => evicted.push(tabId),
  };
  const hub = new NetHub(fake, clock, tabs, (host) => granted(host), sink);
  return { fake, clock, tabs, hub, seen, evicted };
}

function req(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, documentId: 'DOC1', url: 'https://collect.example.net/v1/c?e=1', type: 'xmlhttprequest', timeStamp: 1, requestId: 'r1', method: 'POST', initiator: 'https://www.shop-site.com', ...over };
}

describe('NetHub shared listeners', () => {
  it('nothing while inactive; shared listeners only for features that need them; headers only with gpc', () => {
    const { fake, hub } = setup();
    hub.refresh(false, ['value-match']);
    for (const ev of Object.values(fake.webRequestEvents)) expect(ev.added).toHaveLength(0);
    expect(needsSharedListeners(['history'])).toBe(false);
    hub.refresh(true, ['history']);
    expect(fake.webRequestEvents.sendHeaders.listeners).toHaveLength(0);
    hub.refresh(true, ['value-match']);
    expect(fake.webRequestEvents.sendHeaders.listeners.map((l) => l.extra)).toEqual([[]]);
    expect(fake.webRequestEvents.errorOccurred.listeners).toHaveLength(1);
    expect(fake.webRequestEvents.completed.listeners).toHaveLength(1);
    hub.refresh(true, ['value-match', 'gpc']);
    expect(fake.webRequestEvents.sendHeaders.listeners.map((l) => l.extra)).toEqual([['requestHeaders']]);
    expect(fake.webRequestEvents.sendHeaders.listeners[0]?.filter).toEqual({ urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'ping', 'image', 'script', 'other'] });
    hub.refresh(false, []);
    for (const ev of Object.values(fake.webRequestEvents)) expect(ev.listeners).toHaveLength(0);
  });

  it('cheap checks: negative tab, extension initiator, non-http, ungranted target or initiator are dropped', () => {
    const { fake, hub, seen } = setup((host) => host !== 'blocked.example.org');
    hub.refresh(true, ['firewall']);
    const ev = fake.webRequestEvents.sendHeaders;
    ev.emit(req({ tabId: -1 }));
    ev.emit(req({ initiator: 'chrome-extension://abc' }));
    ev.emit(req({ url: 'https://blocked.example.org/x' }));
    ev.emit(req({ initiator: 'https://blocked.example.org' }));
    expect(seen).toEqual([]);
    ev.emit(req());
    ev.emit(req({ initiator: 'null' }));
    expect(seen.map((s) => s.hook)).toEqual(['send', 'send']);
  });
});

describe('NetHub armed body listeners (filter.tabId + requestBody, pool ≤ 8)', () => {
  it('arm adds one per-tab listener with requestBody; other tabs are not seen; disarm removes it', () => {
    const { fake, hub, seen, tabs } = setup();
    hub.refresh(true, ['value-match']);
    tabs.noteCommitted(committed({ tabId: 7, url: 'https://www.shop-site.com/' }));
    expect(hub.arm(7)).toBe(true);
    expect(hub.arm(7)).toBe(true); // already armed: activity refreshed only
    const before = fake.webRequestEvents.beforeRequest;
    expect(before.listeners).toHaveLength(1);
    expect(before.listeners[0]?.filter.tabId).toBe(7);
    expect(before.listeners[0]?.extra).toEqual(['requestBody']);
    before.emit(req({ tabId: 8 }));
    before.emit(req({ requestBody: { raw: [{ bytes: new ArrayBuffer(4) }] } }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.resolved).toMatchObject({ tabId: 7, receiver: 'example.net', relation: 'cross-site', requestKind: 'xhr', method: 'POST', topSite: 'shop-site.com' });
    expect(hub.disarm(7)).toBe(true);
    expect(before.listeners).toHaveLength(0);
  });

  it('LRU eviction beyond maxArmedTabs; the evicted tab is reported (budget-exceeded)', () => {
    const { fake, hub, evicted, clock } = setup();
    hub.refresh(true, ['value-match']);
    for (let t = 1; t <= PROTECT_BUDGETS.maxArmedTabs; t++) {
      clock.t += 1;
      hub.arm(t);
    }
    clock.t += 1;
    hub.arm(1); // tab 1 becomes the most recent
    hub.arm(100);
    expect(evicted).toEqual([2]);
    expect(fake.webRequestEvents.beforeRequest.listeners).toHaveLength(PROTECT_BUDGETS.maxArmedTabs);
    expect(hub.debug().armedTabs).toContain(1);
    expect(hub.debug().armedTabs).not.toContain(2);
  });

  it('idle tabs are disarmed after armTtlMs; inactive hub refuses to arm', () => {
    const { hub, clock } = setup();
    hub.refresh(true, ['value-match']);
    hub.arm(3);
    clock.t += PROTECT_BUDGETS.armTtlMs;
    hub.sweep();
    expect(hub.isArmed(3)).toBe(false);
    hub.refresh(false, []);
    expect(hub.arm(3)).toBe(false);
  });

  it('SP-11: reregister removes and re-adds every listener with the same filters', () => {
    const { fake, hub } = setup();
    hub.refresh(true, ['value-match']);
    hub.arm(5);
    const addsBefore = fake.webRequestEvents.beforeRequest.added.length;
    hub.reregister();
    expect(fake.webRequestEvents.beforeRequest.added.length).toBe(addsBefore + 1);
    expect(fake.webRequestEvents.beforeRequest.listeners).toHaveLength(1);
    expect(fake.webRequestEvents.beforeRequest.listeners[0]?.filter.tabId).toBe(5);
    expect(fake.webRequestEvents.sendHeaders.listeners).toHaveLength(1);
    hub.stopAll();
    expect(fake.webRequestEvents.beforeRequest.listeners).toHaveLength(0);
  });
});

describe('fastHost', () => {
  it.each([
    ['https://user:pw@Sub.Example.COM:8443/p?q#f', { host: 'sub.example.com', scheme: 'https' }],
    ['http://127.0.0.1:4173/', { host: '127.0.0.1', scheme: 'http' }],
    ['http://[::1]:80/', { host: '[::1]', scheme: 'http' }],
    ['https://example.com.', { host: 'example.com', scheme: 'https' }],
    ['ws://x.example/', null],
    ['data:text/html,x', null],
  ])('%s', (url, expected) => {
    expect(fastHost(url)).toEqual(expected);
  });
});
