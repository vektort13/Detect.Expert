// REQ-004/006/009: inherited navigation without an origin is uncertainty, not a proven denial.
import { describe, expect, it } from 'vitest';
import type { PageBatch } from '@detect-expert/contracts';
import { createBackground } from '../src/index';
import type { Background, MessageResponse, MessageSenderLike } from '../src/index';
import { committed, createFakeChrome, pageSender } from './fake-chrome';

const TOP = 'origin-top', CHILD = 'origin-child';
const key = (id = TOP, frame = 0) => '7:' + frame + ':' + id;
const top = () => committed({ documentId: TOP });
const child = (url = 'about:blank', id = CHILD, frame = 2, parent = TOP) => committed({
  frameId: frame, documentId: id, parentDocumentId: parent, frameType: 'sub_frame', url,
});
const batch = (seq = 1, diagnostics: PageBatch['coverageDelta'] = []): PageBatch => ({ schemaVersion: 1, type: 'sensor-events',
  sensorBootId: 'origin-boot', bridgeSessionId: 'origin-bridge', batchSeq: seq, coverageDelta: diagnostics,
  observations: [{ techniqueId: 'DET-001', phase: 'returned-sync', count: seq, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: 1 }] });
const sender = (url = 'https://example.com/', id = TOP, frame = 0, origin = 'https://example.com') => pageSender({ documentId: id, frameId: frame, url, origin });
const send = (bg: Background, message: unknown, context: MessageSenderLike): Promise<MessageResponse> =>
  new Promise(resolve => { bg.onMessage(message, context, resolve); });
const binding = (bg: Background, id = CHILD) => [...bg.runtime.state.bindings.values()].find(entry => entry.documentId === id);

function make(mode: 'site' | 'all-sites' = 'all-sites') {
  const patterns = mode === 'all-sites' ? ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] : ['https://example.com/*'];
  const fake = createFakeChrome({ grantedOrigins: patterns });
  fake.local.data.set('scope', { v: 1, scopeMode: mode, hosts: mode === 'site' ? ['example.com'] : [] });
  const clock = { t: 1_000_000, now() { return this.t; } };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
  return { bg, fake, clock };
}
async function ready(mode: 'site' | 'all-sites' = 'all-sites') {
  const setup = make(mode);
  await setup.bg.start();
  setup.bg.navigation.onCommitted(top());
  expect(await send(setup.bg, batch(), sender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
  return setup;
}

describe('inherited frame access uncertainty', () => {
  for (const mode of ['site', 'all-sites'] as const) for (const url of ['about:blank', 'about:srcdoc', 'blob:https://example.com/local-id']) {
    it(mode + ': ' + url + ' remains partial until a verified sender resolves it without a historical gap', async () => {
      const { bg } = await ready(mode);
      try {
        bg.navigation.onCommitted(child(url));
        expect(binding(bg)).toMatchObject({ originPending: true, accessGranted: false });
        expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
        expect(bg.runtime.state.reports.get(key())?.coverageFlags).toEqual([]);
        expect(bg.runtime.getProjection(7, 2)?.coverageState).toBe('no-access');
        expect(await send(bg, batch(), sender(url, CHILD, 2))).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
        expect(binding(bg)).toMatchObject({ originPending: false, accessGranted: true });
        expect(bg.runtime.getProjection(7)?.coverageFlags).toEqual(mode === 'site' ? ['network-limited'] : []);
        expect(bg.runtime.getProjection(7)?.coverageState).toBe(mode === 'site' ? 'partial' : 'active');
        expect(bg.runtime.getProjection(7, 2)?.coverageState).toBe(mode === 'site' ? 'partial' : 'active');
        bg.navigation.onCommitted(child(url));
        expect(binding(bg)).toMatchObject({ originPending: false, accessGranted: true, host: 'example.com' });
        expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
      } finally { bg.runtime.stop(); }
    });
  }

  it('quiet children remain pending, nested ancestry is isolated, and retiring unknown frames removes only temporary gaps', async () => {
    const { bg } = await ready();
    try {
      bg.navigation.onCommitted(child('https://example.com/frame'));
      await send(bg, batch(), sender('https://example.com/frame', CHILD, 2));
      bg.navigation.onCommitted(child('about:blank', 'nested', 3, CHILD));
      bg.navigation.onCommitted(committed({ tabId: 8, documentId: 'other-top' }));
      expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      expect(bg.runtime.getProjection(7, 2)?.coverageFlags).toContain('frames-inaccessible');
      expect(bg.runtime.getProjection(8)?.coverageFlags).not.toContain('frames-inaccessible');
      bg.runtime.dispatch({ type: 'frames:retired', documentKeys: [key('nested', 3)], at: 1_000_001 });
      expect(bg.runtime.getProjection(7)?.coverageFlags).toEqual([]);
      expect(bg.runtime.getProjection(7, 2)?.coverageFlags).toEqual([]);
    } finally { bg.runtime.stop(); }
  });

  it('confirmed opaque origin, hook failure, and denied siblings retain historical gaps after healthy child resolution', async () => {
    for (const reason of ['opaque', 'hook', 'denied'] as const) {
      const { bg } = await ready('site');
      try {
        bg.navigation.onCommitted(child());
        bg.navigation.onCommitted(child(reason === 'denied' ? 'https://ungranted.example/' : 'about:blank', 'bad-child', 3));
        if (reason === 'opaque') expect(await send(bg, batch(), sender('about:blank', 'bad-child', 3, 'null'))).toMatchObject({ stopReason: 'revoked' });
        if (reason === 'hook') await send(bg, batch(1, ['hook-failed']), sender('about:blank', 'bad-child', 3));
        expect(bg.runtime.state.reports.get(key())?.coverageFlags).toContain('frames-inaccessible');
        await send(bg, batch(), sender('about:blank', CHILD, 2));
        bg.runtime.dispatch({ type: 'frames:retired', documentKeys: [key('bad-child', 3)], at: 1_000_002 });
        expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      } finally { bg.runtime.stop(); }
    }
  });

  it('foreign or payload-forged origins never authorize an unresolved child; a verified out-of-scope origin is a real denial', async () => {
    const { bg } = await ready('site');
    try {
      bg.navigation.onCommitted(child());
      expect(await send(bg, batch(), { ...sender('about:blank', CHILD, 2), id: 'foreign' })).toMatchObject({ code: 'unauthorized-sender' });
      expect(await send(bg, { ...batch(), origin: 'https://example.com' }, sender('about:blank', CHILD, 2))).toMatchObject({ lastCommittedBatchSeq: 0 });
      expect(binding(bg)).toMatchObject({ originPending: true, accessGranted: false });
      expect(await send(bg, batch(), sender('about:blank', CHILD, 2, 'https://ungranted.example'))).toMatchObject({ stopReason: 'revoked' });
      expect(binding(bg)).toMatchObject({ originPending: false, accessGranted: false });
      expect(bg.runtime.state.reports.get(key())?.coverageFlags).toContain('frames-inaccessible');
    } finally { bg.runtime.stop(); }
  });

  it('clear does not authorize pending children and a reused frame cannot transfer access to a new document', async () => {
    const { bg } = await ready();
    try {
      bg.navigation.onCommitted(child());
      const report = bg.runtime.getProjection(7)!;
      await bg.runtime.clear(7, key(), report.reportRevision);
      await send(bg, batch(2), sender());
      expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      await send(bg, batch(), sender('about:blank', CHILD, 2));
      expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
      bg.navigation.onCommitted(child('about:blank', 'replacement'));
      await send(bg, batch(2), sender('about:blank', CHILD, 2));
      expect(binding(bg, 'replacement')).toMatchObject({ originPending: true, accessGranted: false });
      expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
    } finally { bg.runtime.stop(); }
  });

  it('restart rechecks unknown origins without granting from stored host or destroying earlier observations', async () => {
    const { bg, fake, clock } = await ready('all-sites');
    bg.navigation.onCommitted(child());
    await send(bg, batch(), sender('about:blank', CHILD, 2));
    await bg.runtime.flushIndex();
    fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [top(), child()]);
    bg.runtime.stop();
    const next = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    try {
      await next.start();
      expect(binding(next)).toMatchObject({ originPending: true, accessGranted: false });
      expect(next.runtime.state.metas.get(key(CHILD, 2))?.revoked).toBe(false);
      expect(next.runtime.state.reports.get(key(CHILD, 2))?.counters[0]?.count).toBe(1);
      expect(next.runtime.getProjection(7, 2)).toMatchObject({ coverageState: 'no-access', techniques: [] });
      expect(next.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      await send(next, batch(2), sender('about:blank', CHILD, 2));
      expect(binding(next)).toMatchObject({ originPending: false, accessGranted: true });
      expect(next.runtime.getProjection(7)?.coverageFlags).toEqual([]);
      expect(next.runtime.getProjection(7, 2)?.techniques[0]?.count).toBe(2);
    } finally { next.runtime.stop(); }
  });

  it('actual permission removal still purges a previously verified inherited child', async () => {
    const { bg, fake } = await ready('site');
    try {
      bg.navigation.onCommitted(child()); await send(bg, batch(), sender('about:blank', CHILD, 2));
      fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [top(), child()]); fake.grantedOrigins.clear();
      await bg.runtime.onPermissionsChanged();
      expect(bg.runtime.getProjection(7, 2)).toMatchObject({ coverageState: 'no-access', techniques: [] });
      expect(bg.runtime.state.metas.get(key(CHILD, 2))?.revoked).toBe(true);
      expect(await send(bg, batch(2), sender('about:blank', CHILD, 2))).toMatchObject({ stopReason: 'revoked' });
    } finally { bg.runtime.stop(); }
  });

  for (const change of ['off', 'removed'] as const) it('restart with ' + change + ' access purges inherited observations', async () => {
    const { bg, fake, clock } = await ready('site');
    bg.navigation.onCommitted(child()); await send(bg, batch(), sender('about:blank', CHILD, 2));
    await bg.runtime.flushIndex(); bg.runtime.stop();
    fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [top(), child()]);
    if (change === 'off') fake.local.data.set('scope', { v: 1, scopeMode: 'off', hosts: ['example.com'] });
    else fake.grantedOrigins.clear();
    const next = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    try {
      await next.start();
      expect(next.runtime.state.reports.get(key(CHILD, 2))?.counters).toEqual([]);
      expect(next.runtime.state.metas.get(key(CHILD, 2))?.revoked).toBe(true);
      expect(next.runtime.getProjection(7, 2)).toMatchObject({ coverageState: 'no-access', techniques: [] });
      expect(await send(next, batch(2), sender('about:blank', CHILD, 2))).toMatchObject({ stopReason: 'revoked' });
    } finally { next.runtime.stop(); }
  });

  for (const changed of [false, true]) it('narrow restart purges unresolved history' + (changed ? ' when only unrelated grants remain' : ' without inferring an exact grant from a redacted host'), async () => {
    const { bg, fake, clock } = await ready('site');
    bg.navigation.onCommitted(child()); await send(bg, batch(), sender('about:blank', CHILD, 2));
    await bg.runtime.flushIndex(); bg.runtime.stop();
    fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [top(), child()]);
    if (changed) {
      fake.grantedOrigins.clear(); fake.grantedOrigins.add('https://unrelated.example/*');
      fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['unrelated.example'] });
    }
    const next = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    try {
      await next.start();
      expect(binding(next)).toMatchObject({ originPending: true, accessGranted: false });
      expect(next.runtime.state.reports.get(key(CHILD, 2))?.counters).toEqual([]);
      expect(next.runtime.state.reports.get(key())?.coverageFlags).not.toContain('frames-inaccessible');
      expect(next.runtime.getProjection(7, 2)).toMatchObject({ coverageState: 'no-access', techniques: [] });
      const response = await send(next, batch(2), sender('about:blank', CHILD, 2));
      expect(response).toMatchObject(changed ? { stopReason: 'revoked' } : { lastCommittedBatchSeq: 2 });
      expect(binding(next)).toMatchObject({ accessGranted: !changed, originPending: false });
    } finally { next.runtime.stop(); }
  });

  it('pending bookkeeping stays within admitted frame bounds and prerender uncertainty does not affect the active page', async () => {
    const { bg } = await ready();
    try {
      bg.navigation.onCommitted({ ...child(), documentLifecycle: 'prerender' });
      expect(bg.runtime.getProjection(7)?.coverageFlags).toEqual([]);
      for (let i = 0; i < 150; i++) bg.navigation.onCommitted(child('about:blank', 'pending-' + i, i + 10));
      expect(bg.runtime.state.bindings.size).toBeLessThanOrEqual(128);
      expect([...bg.runtime.state.bindings.values()].filter(entry => entry.originPending).length).toBeLessThanOrEqual(127);
      expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      bg.navigation.onTabRemoved(7);
      expect(bg.runtime.state.bindings.size).toBe(0);
    } finally { bg.runtime.stop(); }
  });

  for (const mode of ['site', 'all-sites'] as const) it(mode + ': queued startup decisions are unknown until actual grants resolve them', async () => {
    const { bg } = make(mode);
    try {
      bg.navigation.onCommitted(top());
      bg.navigation.onCommitted(child('https://example.com/frame'));
      await bg.start();
      await send(bg, batch(), sender());
      expect(bg.runtime.state.reports.get(key())?.coverageFlags).toEqual([]);
      expect(binding(bg)).toMatchObject({ originPending: mode === 'site', accessGranted: mode === 'all-sites' });
      if (mode === 'site') expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
      bg.navigation.onCommitted(child('https://example.com/frame'));
      expect(bg.runtime.state.reports.get(key(CHILD, 2))?.coverageFlags).not.toContain('no-host-permission');
      await send(bg, batch(), sender('https://example.com/frame', CHILD, 2));
      expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
    } finally { bg.runtime.stop(); }
  });
});
