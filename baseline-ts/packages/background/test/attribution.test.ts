import { expect, it } from 'vitest';
import { createBackground } from '../src/index';
import { createFakeChrome, committed } from './fake-chrome';
it.each([
  [true, true, true], [true, false, false], [false, true, false], [false, false, false],
])('P01 target grant %s, initiator grant %s -> captured %s', async (target, initiator, captured) => {
  const fake = createFakeChrome({ grantedOrigins: [...(target ? ['https://*.vendor.com/*'] : []), ...(initiator ? ['https://example.com/*'] : [])] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const bg = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
  await bg.start();
  try {
    const nav = committed();
    bg.navigation.onCommitted(nav);
    bg.network.onCompleted({ tabId: 7, frameId: 0, documentId: nav.documentId, type: 'script', timeStamp: 1,
      initiator: 'https://example.com', url: 'https://random-canary.vendor.com/script.js?q=secret' });
    const r = [...bg.runtime.state.reports.values()][0]!;
    expect(r.hosts.length).toBe(captured ? 1 : 0);
    if (captured) expect(r.hosts[0]).toMatchObject({ registrableDomain: 'vendor.com', relation: 'cross-site', requestCount: 1 });
    expect(JSON.stringify([...bg.runtime.state.reports.values()])).not.toContain('random-canary');
    expect(JSON.stringify(r)).not.toContain('secret');
  } finally { bg.runtime.stop(); }
});

import { readPageSender } from '../src/sender';
import { pageSender, RUNTIME_ID } from './fake-chrome';
import { redactStoredHosts, SessionRepository } from '../src/repository';
const batch = { schemaVersion: 1 as const, type: 'sensor-events' as const, sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq: 1,
  observations: [{ techniqueId: 'DET-001' as const, count: 1, countQuality: 'exact' as const, phase: 'attempted' as const, signalCodes: ['api-use' as const], intervalBucket: 1 }], coverageDelta: [] };

it('P01 active top grant survives iframe and prerender commits', async () => {
  const fake = createFakeChrome();
  const nav = committed();
  fake.framesByTab.set(7, [nav]);
  const bg = createBackground(fake, { ttlIntervalMs: 0 });
  await bg.start();
  try {
    bg.navigation.onCommitted(nav);
    expect((await bg.runtime.injectNow(7)).type).toBe('ok');
    bg.navigation.onCommitted(committed({ frameId: 2, documentId: 'CHILD', frameType: 'sub_frame' }));
    bg.navigation.onCommitted(committed({ documentId: 'PRERENDER', documentLifecycle: 'prerender' }));
    const sender = readPageSender(pageSender(), RUNTIME_ID);
    if (!sender.ok) throw new Error('invalid fixture sender');
    expect(await bg.runtime.handleBatch(sender.context, batch)).toMatchObject({ lastCommittedBatchSeq: 1 });
  } finally { bg.runtime.stop(); }
});
it('P01 activeTab switch revokes old site capabilities even with retained host permissions', async () => {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*', 'https://*.vendor.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  fake.framesByTab.set(8, [committed({ tabId: 8, documentId: 'SECOND' })]);
  const bg = createBackground(fake, { ttlIntervalMs: 0 });
  await bg.start();
  try {
    bg.navigation.onCommitted(committed());
    bg.navigation.onCommitted(committed({ tabId: 8, documentId: 'SECOND' }));
    expect((await bg.runtime.injectNow(8)).type).toBe('ok');
    bg.network.onCompleted({ tabId: 7, frameId: 0, documentId: committed().documentId, type: 'script', timeStamp: 1, initiator: 'https://example.com', url: 'https://a.vendor.com/a.js' });
    const report = [...bg.runtime.state.reports.values()].find((r) => r.tabId === 7)!;
    expect(report.hosts).toEqual([]);
    expect(report.host).toBeNull();
    expect(bg.runtime.state.metas.get(report.documentKey)?.accessGranted).toBe(false);
  } finally { bg.runtime.stop(); }
});
it('P01 a concurrent batch cannot restore access during permission refresh with failed frame query', async () => {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const bg = createBackground(fake, { ttlIntervalMs: 0 });
  await bg.start();
  try {
    bg.navigation.onCommitted(committed());
    const sender = readPageSender(pageSender(), RUNTIME_ID);
    if (!sender.ok) throw new Error('invalid fixture sender');
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    fake.permissions.getAll = async () => { await deferred; return { origins: [] }; };
    fake.tabs.query = async () => { throw new Error('browser unavailable'); };
    const refresh = bg.runtime.onPermissionsChanged();
    await Promise.resolve();
    await expect(bg.runtime.handleBatch(sender.context, batch)).rejects.toThrow('access-changing');
    release();
    await refresh;
    expect(await bg.runtime.handleBatch(sender.context, batch)).toMatchObject({ lastCommittedBatchSeq: 0, stopReason: 'revoked' });
  } finally { bg.runtime.stop(); }
});
it('P01 stored host migration reconstructs the allowlist and strips hostile categories and extra raw fields', () => {
  const hosts = redactStoredHosts([
    { category: 'random-canary.example.com', host: '127.0.0.1' },
    { category: 'loopback', host: '127.0.0.1', query: 'secret', requestCount: 3, relation: 'same-site', firstSeenBucket: 1, lastSeenBucket: 2 },
    { registrableDomain: 'random-canary.example.com', requestCount: 1 },
  ]);
  expect(hosts).toHaveLength(2);
  expect(hosts[0]).toMatchObject({ category: 'loopback', requestCount: 3 });
  expect(hosts[1]).toMatchObject({ registrableDomain: 'example.com' });
  expect(JSON.stringify(hosts)).not.toMatch(/random-canary|127\.0\.0\.1|secret|query/);
});

it('P01 failed scope request leaves existing network capability usable', async () => {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*', 'https://*.vendor.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const bg = createBackground(fake, { ttlIntervalMs: 0 });
  await bg.start();
  try {
    bg.navigation.onCommitted(committed());
    expect(await bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).toMatchObject({ ok: false });
    expect(await bg.runtime.scope.injectNow(99, 'example.com', 'MISSING')).toBe(false);
    bg.network.onCompleted({ tabId: 7, frameId: 0, documentId: committed().documentId, type: 'script', timeStamp: 1, initiator: 'https://example.com', url: 'https://a.vendor.com/a.js' });
    expect([...bg.runtime.state.reports.values()][0]!.hosts[0]?.registrableDomain).toBe('vendor.com');
  } finally { bg.runtime.stop(); }
});
it('P01 harmless permission refresh retries a batch and then preserves collection', async () => {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  fake.framesByTab.set(7, [committed()]);
  fake.tabList = [{ id: 7 }];
  const bg = createBackground(fake, { ttlIntervalMs: 0 });
  await bg.start();
  try {
    const sender = readPageSender(pageSender(), RUNTIME_ID);
    if (!sender.ok) throw new Error('invalid fixture sender');
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    fake.permissions.getAll = async () => { await deferred; return { origins: ['https://example.com/*'] }; };
    const refresh = bg.runtime.onPermissionsChanged();
    await Promise.resolve();
    await expect(bg.runtime.handleBatch(sender.context, batch)).rejects.toThrow('access-changing');
    release();
    await refresh;
    expect(await bg.runtime.handleBatch(sender.context, batch)).toMatchObject({ lastCommittedBatchSeq: 1, paused: false });
  } finally { bg.runtime.stop(); }
});

it('P01 migration removes malformed legacy records from session storage', async () => {
  const fake = createFakeChrome();
  fake.session.data.set('doc:legacy', { host: 'random-canary.example.com', url: 'http://127.0.0.1/?secret' });
  fake.session.data.set('index', { invalid: 'random-canary.example.com' });
  const loaded = await new SessionRepository(fake.storage.session).loadAll();
  expect(loaded.discarded).toBe(2);
  expect(fake.session.data.has('doc:legacy')).toBe(false);
  expect(fake.session.data.has('index')).toBe(false);
});
