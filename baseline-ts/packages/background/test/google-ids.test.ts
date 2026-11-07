import { describe, expect, it, vi } from 'vitest';
import { createBackground, route } from '../src/index';
import { normalizeGoogleClientData } from '../src/google-ids';
import { createFakeChrome } from './fake-chrome';
import type { RequestHeadersDetailsLike } from '../src/chrome-api';
import { readGoogleIdsState } from '../../contracts/src/google-ids';

const header = 'CIetSw==';
const host = 'www.google.com';
const request = { schemaVersion: 1, type: 'ui-google-ids', tabId: 7, frameId: 0, documentKey: '7:0:document' };

async function setup() {
  const clock = { value: 100000, now() { return this.value; } };
  const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
  api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
  api.tabList = [{ id: 7 }];
  api.framesByTab.set(7, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
  const background = createBackground(api, { clock, ttlIntervalMs: 0, persistDebounceMs: 0 });
  await background.start();
  background.runtime.googleIds.setSupported(true);
  const sender = { id: api.runtime.id, origin: 'chrome-extension://' + api.runtime.id, url: 'chrome-extension://' + api.runtime.id + '/popup.html' };
  const event: RequestHeadersDetailsLike = { tabId: 7, frameId: 0, documentId: 'document', initiator: 'https://example.com',
    url: 'https://' + host + '/path?NOT_RETAINED', type: 'xmlhttprequest', requestId: 'request', timeStamp: clock.value,
    requestHeaders: [{ name: 'X-Client-Data', value: header }] };
  const read = async (documentKey = request.documentKey) => readGoogleIdsState(await route(background.runtime, { ...request, documentKey }, sender));
  return { api, background, clock, sender, event, read };
}

describe('ADR-040 browser-only Google IDs RAM', () => {
  it('reads only X-Client-Data, not cookie/Authorization or arbitrary value accessors', () => {
    const read = vi.fn(() => { throw new Error('private value read'); });
    const headers = [{ name: 'X-Client-Data', value: header },
      Object.defineProperty({ name: 'Cookie' }, 'value', { get: read }),
      Object.defineProperty({ name: 'Authorization' }, 'value', { get: read })];
    expect(normalizeGoogleClientData(headers, host)).toEqual({ host, header, status: 'observed' });
    expect(read).not.toHaveBeenCalled();
    expect(normalizeGoogleClientData([Object.defineProperty({ name: 'X-Client-Data' }, 'value', { get: read })], host).status).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it('distinguishes true observed absence, unavailable arrays, duplicate headers and an oversized value', () => {
    expect(normalizeGoogleClientData([], host).status).toBe('not-present');
    expect(normalizeGoogleClientData(undefined, host).status).toBe('unavailable');
    expect(normalizeGoogleClientData(new Array(129), host).status).toBe('unavailable');
    expect(normalizeGoogleClientData([{ name: 'X-Client-Data', value: 'a'.repeat(4100) }], host)).toEqual({ host, status: 'too-large', header: null });
    expect(normalizeGoogleClientData([{ name: 'X-Client-Data', value: header }, { name: 'x-client-data', value: header }], host).status).toBe('invalid');
  });

  it('returns exactly the browser header only to the current privileged UI, never report/storage/export', async () => {
    const { background, api, event, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      expect((await read())?.entries).toEqual([{ host, header, status: 'observed' }]);
      const projection = background.runtime.getProjection(7)!;
      const exported = await background.runtime.exportPreview(7, projection.documentKey, projection.reportRevision);
      await background.runtime.repository.run('7:0:document', () => background.runtime.persistNow('7:0:document'));
      expect(JSON.stringify([projection, exported, background.runtime.buildIndex(), background.runtime.diagnostics(), [...api.session.data], [...api.local.data]])).not.toMatch(/CIetSw|NOT_RETAINED|google-ids/);
      const page = { id: api.runtime.id, tab: { id: 7 }, frameId: 0, documentId: 'document', origin: 'https://example.com', url: 'https://example.com/' };
      expect(await route(background.runtime, request, page)).toMatchObject({ type: 'error', code: 'unauthorized-sender' });
      expect((await read('7:0:previous'))?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it.each(['foreign-document', 'wrong-frame', 'lookalike-host', 'http', 'opaque-initiator', 'prerender', 'background-tab'])('ignores %s before reading headers', async kind => {
    const { background, event, read } = await setup();
    try {
      const patches: Record<string, Partial<RequestHeadersDetailsLike>> = { 'foreign-document': { documentId: 'other' }, 'wrong-frame': { frameId: 1 },
        'lookalike-host': { url: 'https://www.google.com.evil.test/' }, http: { url: 'http://www.google.com/' },
        'opaque-initiator': { initiator: 'null' }, prerender: { documentLifecycle: 'prerender' }, 'background-tab': { tabId: -1 } };
      const inspect = vi.fn(() => event.requestHeaders);
      background.runtime.googleIds.onSendHeaders(Object.defineProperty({ ...event, ...patches[kind] }, 'requestHeaders', { get: inspect }));
      expect(inspect).not.toHaveBeenCalled();
      expect((await read())?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it.each(['clear', 'pause', 'revoke', 'ttl', 'restart', 'clear-session'])('invalidates exact values on %s', async kind => {
    const { background, api, clock, event, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      expect((await read())?.entries).toHaveLength(1);
      const report = background.runtime.getProjection(7)!;
      if (kind === 'clear') await background.runtime.clear(7, report.documentKey, report.reportRevision);
      if (kind === 'pause') await background.runtime.pause(7, report.documentKey, report.reportRevision);
      if (kind === 'revoke') await background.runtime.onPermissionsChanged();
      if (kind === 'ttl') clock.value += 600001;
      if (kind === 'clear-session') await background.runtime.clearSession();
      if (kind === 'restart') {
        background.runtime.stop();
        const restarted = createBackground(api, { clock, ttlIntervalMs: 0, persistDebounceMs: 0 });
        await restarted.start(); restarted.runtime.googleIds.setSupported(true);
        const response = await restarted.runtime.googleIds.route(request, { id: api.runtime.id, origin: 'chrome-extension://' + api.runtime.id });
        expect(readGoogleIdsState(response)?.entries).toEqual([]); restarted.runtime.stop();
      } else expect((await read())?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it.each(['committed', 'aborted', 'ambiguous', 'expired'])('keeps navigation headers out of the old document (%s)', async outcome => {
    const { background, api, clock, event, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      const before = { tabId: 7, frameId: 0, url: 'https://www.google.com/', timeStamp: clock.value };
      background.navigation.onBeforeNavigate(before);
      const navigating = { ...event, ...before, type: 'main_frame', requestId: 'navigation', documentId: undefined };
      background.runtime.googleIds.onBeforeRequest(navigating);
      background.runtime.googleIds.onSendHeaders({ ...navigating, requestHeaders: [{ name: 'X-Client-Data', value: 'COcH' }] });
      expect((await read())?.entries[0]?.header).toBe(header);
      if (outcome === 'aborted') {
        background.navigation.onErrorOccurred(before);
        expect((await read())?.entries[0]?.header).toBe(header);
        return;
      }
      if (outcome === 'ambiguous') background.runtime.googleIds.onBeforeRequest({ ...navigating, requestId: 'another' });
      if (outcome === 'expired') clock.value += 2001;
      api.framesByTab.set(7, [{ frameId: 0, documentId: 'next', url: before.url, documentLifecycle: 'active' }]);
      background.navigation.onCommitted({ ...before, documentId: 'next', frameType: 'outermost_frame', documentLifecycle: 'active' });
      const next = await read('7:0:next');
      expect(next?.entries).toEqual(outcome === 'committed' ? [{ host, status: 'observed', header: 'COcH' }] : []);
      expect((await read())?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it('does not return an in-flight snapshot after browser permission reconciliation', async () => {
    const { background, api, event, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      let release!: (value: boolean) => void;
      const original = api.permissions.contains.bind(api.permissions);
      vi.spyOn(api.permissions, 'contains').mockImplementation(async details => details.origins?.[0] === 'https://www.google.com/*'
        ? new Promise<boolean>(resolve => { release = resolve; }) : original(details));
      const pending = read();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      background.runtime.googleIds.clear(); release(true);
      expect((await pending)?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it('bounds host rows and rate-limits with an explicit incomplete marker', async () => {
    const { background, event, read } = await setup();
    try {
      for (let index = 0; index < 30; index++) background.runtime.googleIds.onSendHeaders({ ...event, url: 'https://h' + index + '.google.com/' });
      const value = await read();
      expect(value?.entries.length).toBeLessThanOrEqual(8);
      expect(value?.truncated).toBe(true);
    } finally { background.runtime.stop(); }
  });

  it('does not extend another destination TTL or retain values after runtime stop', async () => {
    const { background, event, clock, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      clock.value += 599000;
      background.runtime.googleIds.onSendHeaders({ ...event, url: 'https://clients.google.com/' });
      clock.value += 1001;
      expect((await read())?.entries.map(row => row.host)).toEqual(['clients.google.com']);
      background.runtime.stop();
      expect((await read())?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it('checks live browser document identity again after permissions resolve', async () => {
    const { background, api, event, read } = await setup();
    try {
      background.runtime.googleIds.onSendHeaders(event);
      const original = api.permissions.contains.bind(api.permissions);
      vi.spyOn(api.permissions, 'contains').mockImplementation(async details => {
        if (details.origins?.[0] === 'https://www.google.com/*') api.framesByTab.set(7, [{ frameId: 0, documentId: 'next', url: 'https://example.com/' }]);
        return original(details);
      });
      expect((await read())?.entries).toEqual([]);
    } finally { background.runtime.stop(); }
  });

  it.each(['document', 'host'])('invalidates an in-flight read when its %s is evicted by capacity', async kind => {
    const { background, api, event, read, clock } = await setup();
    try {
      const additions: RequestHeadersDetailsLike[] = [];
      for (let index = 0; index < 8; index++) {
        if (kind === 'host') additions.push({ ...event, url: 'https://extra' + index + '.google.com/' });
        else {
          const tabId = 20 + index, documentId = 'document-' + index;
          api.tabList.push({ id: tabId });
          api.framesByTab.set(tabId, [{ frameId: 0, documentId, url: 'https://example.com/', documentLifecycle: 'active' }]);
          background.navigation.onCommitted({ tabId, frameId: 0, documentId, url: 'https://example.com/', timeStamp: clock.value,
            frameType: 'outermost_frame', documentLifecycle: 'active' });
          additions.push({ ...event, tabId, documentId });
        }
      }
      background.runtime.googleIds.onSendHeaders(event);
      expect((await read())?.entries).toHaveLength(1);
      let release!: (value: boolean) => void;
      const original = api.permissions.contains.bind(api.permissions);
      vi.spyOn(api.permissions, 'contains').mockImplementation(async details => details.origins?.[0] === 'https://www.google.com/*'
        ? new Promise<boolean>(resolve => { release = resolve; }) : original(details));
      const pending = read();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      for (const addition of additions) background.runtime.googleIds.onSendHeaders(addition);
      release(true);
      expect((await pending)?.entries).toEqual([]);
      expect((await read())?.entries.some(row => row.host === host)).toBe(false);
    } finally { background.runtime.stop(); }
  });
});