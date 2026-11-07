import type { Ack, ProtectAck, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { createBackground } from '../../src/index';
import type { Background, MessageSenderLike } from '../../src/index';
import { readSenderTabTop } from '../../src/sender';
import { committed, createFakeChrome, pageSender, settle, uiSender } from '../fake-chrome';
import type { FakeChrome } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, defaultServices, optionsSender } from './support';

function send(bg: Background, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse | ProtectAck> {
  return new Promise((resolve) => {
    const respond = resolve as (r: Ack | UiResponse) => void;
    expect(bg.onMessage(message, sender, respond)).toBe(true);
  });
}

async function setup(scopeAllSites = true): Promise<{ fake: FakeChrome; bg: Background; db: MemoryProtectDb; created: () => number }> {
  const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
  if (scopeAllSites) fake.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
  const db = new MemoryProtectDb();
  let created = 0;
  const log: string[] = [];
  const bg = createBackground(fake, {
    ttlIntervalMs: 0,
    persistDebounceMs: 1,
    protect: { dbFactory: () => { created++; return db; }, services: defaultServices(log), dnrTimeoutMs: 50, docStore: { flushMs: 1 } },
  });
  fake.events.onCommitted.addListener(bg.navigation.onCommitted);
  fake.events.tabRemoved.addListener(bg.navigation.onTabRemoved);
  fake.webRequest.onBeforeRequest.addListener(bg.network.onBeforeRequest, bg.network.filter);
  await bg.start();
  await bg.runtime.protect.idle();
  return { fake, bg, db, created: () => created };
}

const SHOP = { url: 'https://www.shop-site.com/a?b=1', origin: 'https://www.shop-site.com' };

describe('routing of the module (ADR-020 §9) through runtime.onMessage', () => {
  it('module off with observation all-sites: observation listeners only, no module side effects', async () => {
    const { fake, bg, created } = await setup();
    bg.navigation.onCommitted(committed({ url: SHOP.url }));
    expect(await send(bg, { schemaVersion: 1, type: 'protect-hello', startedLate: false }, pageSender(SHOP))).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-get-report', tabId: 7 }, uiSender())).toEqual({ schemaVersion: 1, type: 'protect-report', report: null });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-clear-session' }, optionsSender())).toMatchObject({ type: 'ok' });
    await settle(10);
    expect(created()).toBe(0);
    expect(fake.webRequestEvents.beforeRequest.added).toHaveLength(1);
    expect(fake.webRequestEvents.beforeRequest.added[0]?.extra).toBeUndefined();
    expect(fake.webRequestEvents.sendHeaders.added).toHaveLength(0);
    expect(fake.webRequestEvents.errorOccurred.added).toHaveLength(0);
    expect([...fake.registered.keys()].sort()).toEqual(['detector-isolated-v1', 'detector-main-v1']);
    expect(fake.dnrAccesses).toBe(0);
    expect(fake.local.data.has('protect')).toBe(false);
    expect([...fake.session.data.keys()].filter((k) => k.startsWith('protect'))).toEqual([]);
    const diag = bg.runtime.diagnostics().protect;
    expect(diag).toMatchObject({ enabled: 0, active: 0, armedTabs: 0, docs: 0 });
    for (const v of Object.values(diag)) expect(typeof v).toBe('number');
  });

  it('enable and set-settings from the popup → unauthorized-sender; from Options → protect-state', async () => {
    const { bg } = await setup();
    const enable = { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match'], preset: 'normal' };
    expect(await send(bg, enable, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await send(bg, enable, uiSender({ url: 'chrome-extension://' + 'abcdefghijklmnopabcdefghijklmnop' + '/sidepanel.html' }))).toMatchObject({ code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }, uiSender())).toMatchObject({ code: 'unauthorized-sender' });
    expect(await send(bg, enable, optionsSender())).toMatchObject({ type: 'protect-state', state: { state: 'active', features: ['value-match'] } });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }, optionsSender('options.html#protect'))).toMatchObject({ state: { preset: 'strict' } });
  });

  it('a page never reaches ui-protect-*; module page messages get protect-ack', async () => {
    const { bg } = await setup();
    await send(bg, { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'session-replay'], preset: 'normal' }, optionsSender());
    bg.navigation.onCommitted(committed({ url: SHOP.url }));
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-get-state' }, pageSender(SHOP))).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-disable', purge: true }, pageSender(SHOP))).toMatchObject({ code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'protect-hello', startedLate: false }, pageSender(SHOP))).toEqual({ schemaVersion: 1, type: 'protect-ack', active: true, groups: 3 });
    expect(await send(bg, { schemaVersion: 2, type: 'protect-hello', startedLate: false }, pageSender(SHOP))).toMatchObject({ type: 'protect-ack', active: false });
    expect(await send(bg, { schemaVersion: 1, type: 'protect-hello', startedLate: false }, pageSender({ url: 'data:text/html,x', origin: 'null' }))).toMatchObject({ type: 'protect-ack', active: false });
    expect(await send(bg, { schemaVersion: 1, type: 'protect-hello', startedLate: false }, pageSender({ ...SHOP, id: 'foreign' }))).toMatchObject({ code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-protect-nonsense' }, optionsSender())).toMatchObject({ code: 'invalid-request' });
    const report = await send(bg, { schemaVersion: 1, type: 'ui-protect-get-report', tabId: 7 }, uiSender());
    expect(report).toMatchObject({ type: 'protect-report', report: { site: 'shop-site.com', moduleState: 'active' } });
  });

  it('commits, closed tabs and clear-session reach the module only while it is active', async () => {
    const { bg, fake } = await setup();
    await send(bg, { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match'], preset: 'normal' }, optionsSender());
    bg.navigation.onCommitted(committed({ url: SHOP.url }));
    expect(bg.runtime.protect.tabModel.get(7)?.site).toBe('shop-site.com');
    await send(bg, { schemaVersion: 1, type: 'protect-hello', startedLate: true }, pageSender(SHOP));
    await settle(10);
    expect([...fake.session.data.keys()].some((k) => k.startsWith('protect-doc:7:0:'))).toBe(true);
    await send(bg, { schemaVersion: 1, type: 'ui-clear-session' }, optionsSender());
    expect([...fake.session.data.keys()].some((k) => k.startsWith('protect-doc:'))).toBe(false);
    bg.navigation.onTabRemoved(7);
    expect(bg.runtime.protect.tabModel.get(7)).toBeUndefined();
  });

  it('review r2: the tab URL of MessageSender reaches the module; a cross-site frame in an excluded site tab loaded before enable gets inactive', async () => {
    const { bg } = await setup();
    await send(bg, { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'session-replay'], preset: 'normal' }, optionsSender());
    await send(bg, { schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank-site.com', excluded: true }, optionsSender());
    const hello = { schemaVersion: 1, type: 'protect-hello', startedLate: false };
    const frame = (tabId: number, tabUrl: string | undefined): MessageSenderLike => pageSender({
      tabId,
      frameId: 3,
      url: 'https://chat.widget-host.net/embed?id=1',
      origin: 'https://chat.widget-host.net',
      docId: 'DOC00000000000000000000000000' + String(tabId) + '03',
      ...(tabUrl === undefined ? {} : { tab: { id: tabId, url: tabUrl } }),
    });
    // No onCommitted for tabs 7, 8, 9: their top documents loaded before the module was enabled.
    expect(await send(bg, hello, frame(7, 'https://www.bank-site.com/login?user=a#x'))).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    expect(await send(bg, hello, frame(8, undefined))).toMatchObject({ type: 'protect-ack', active: false });
    expect(await send(bg, hello, frame(9, 'https://www.shop-site.com/cart'))).toEqual({ schemaVersion: 1, type: 'protect-ack', active: true, groups: 3 });
    expect(bg.runtime.protect.tabModel.get(7)?.site).toBe('bank-site.com');
    expect(JSON.stringify(bg.runtime.protect.tabModel.entries())).not.toContain('login');
  });
});

describe('readSenderTabTop (review r2)', () => {
  it('host and scheme of the tab URL only; null without a tab URL or for a non-http(s) top document', () => {
    expect(readSenderTabTop(pageSender({ tab: { id: 7, url: 'https://User:pw@WWW.Bank-Site.com:8443/a?b=1#c' } }))).toEqual({ host: 'www.bank-site.com', scheme: 'https' });
    expect(readSenderTabTop(pageSender({ tab: { id: 7, url: 'http://127.0.0.1:8080/x' } }))).toEqual({ host: '127.0.0.1', scheme: 'http' });
    expect(readSenderTabTop(pageSender())).toBeNull();
    expect(readSenderTabTop(pageSender({ tab: { id: 7, url: 'file:///C:/x.html' } }))).toBeNull();
    expect(readSenderTabTop(pageSender({ tab: { id: 7, url: 'about:blank' } }))).toBeNull();
    expect(readSenderTabTop(pageSender({ tab: undefined }))).toBeNull();
  });
});
