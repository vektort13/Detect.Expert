import { describe, expect, it, vi } from 'vitest';
import type { ApiResultsState } from '@detect-expert/contracts';
import { createBackground, readStoredIndex } from '../src/index';
import type { Background, MessageResponse } from '../src/index';
import { createFakeChrome, pageSender, uiSender } from './fake-chrome';

const documentId = 'DOC000000000000000000000000000001';
const documentKey = '7:0:' + documentId;
const request = { schemaVersion: 1, type: 'ui-api-results', tabId: 7, frameId: 0, documentKey };
const row = { operation: 'GPUAdapterInfo.vendor', techniqueId: 'DET-013', phase: 'returned-sync', value: { kind: 'string', value: 'LOCAL_GPU_PREVIEW_CANARY' } };
const cache = { schemaVersion: 1, type: 'api-results-cache', available: true, rows: [row], truncated: false, epoch: 0 };
const send = (background: Background, message: unknown = request): Promise<MessageResponse> => new Promise(resolve => background.onMessage(message, uiSender(), resolve));

async function setup(persistDebounceMs = 0) {
  const api = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  api.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  api.tabList = [{ id: 7 }];
  api.framesByTab.set(7, [{ frameId: 0, documentId, url: 'https://example.com/', documentLifecycle: 'active' }]);
  const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs });
  await background.start();
  api.tabs.sendMessage = vi.fn(async () => cache);
  return { api, background };
}

describe('ADR-036 result preview authorization and lifecycle', () => {
  it('returns only current authorized results through UI and never writes them to storage', async () => {
    const { api, background } = await setup();
    const response = await send(background) as ApiResultsState;
    expect(response).toMatchObject({ type: 'api-results-state', documentKey, rows: [row], integrity: 'page-controlled', available: true });
    expect(JSON.stringify([...api.session.data.values()])).not.toContain('LOCAL_GPU_PREVIEW_CANARY');
    expect(JSON.stringify([...api.local.data.values()])).not.toContain('LOCAL_GPU_PREVIEW_CANARY');
    expect(background.runtime.getProjection(7)).not.toHaveProperty('rows');
  });

  it('rejects page senders, stale document IDs and forged nested values', async () => {
    const { api, background } = await setup();
    const denied = await new Promise(resolve => background.onMessage(request, pageSender(), resolve));
    expect(denied).toMatchObject({ code: 'unauthorized-sender' });
    expect(await send(background, { ...request, documentKey: '7:0:other' })).toMatchObject({ available: false, rows: [] });
    api.tabs.sendMessage = vi.fn(async () => ({ ...cache, rows: [{ ...row, value: { kind: 'string', value: 'x'.repeat(257) } }] }));
    expect(await send(background)).toMatchObject({ available: false, rows: [] });
  });

  it('discards an in-flight result when permission generation changes without navigation', async () => {
    const { api, background } = await setup();
    let finish: (value: unknown) => void = () => undefined;
    api.tabs.sendMessage = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const response = send(background);
    await vi.waitFor(() => expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1));
    api.grantedOrigins.clear();
    await background.runtime.scope.onPermissionsChanged();
    finish(cache);
    expect(await response).toMatchObject({ available: false, rows: [] });
  });

  it('persists a reset marker when clear cannot reach the bridge and forces reset after restart', async () => {
    const { api, background } = await setup();
    api.tabs.sendMessage = vi.fn(async () => { throw new Error('temporarily unreachable'); });
    const projection = background.runtime.getProjection(7)!;
    expect(await send(background, { schemaVersion: 1, type: 'ui-clear', tabId: 7, documentKey, reportRevision: projection.reportRevision })).toMatchObject({ type: 'ok' });
    await background.runtime.flushIndex();
    const saved = readStoredIndex(api.session.data.get('index'));
    expect(saved?.bindings[0]?.apiResultsResetRequired).toBe(true);
    const restarted = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await restarted.start();
    api.tabs.sendMessage = vi.fn(async (_tabId, message) => (message as { type: string }).type === 'api-results-reset'
      ? { schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 } : { ...cache, rows: [], epoch: 1 });
    expect(await send(restarted)).toMatchObject({ available: true, rows: [] });
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { schemaVersion: 1, type: 'api-results-reset' }, { frameId: 0, documentId });
    expect(restarted.runtime.state.bindings.get('7:0')?.apiResultsResetRequired).not.toBe(true);
  });

  it('does not count a delayed earlier reset acknowledgement as a fresh second clear', async () => {
    const { api, background } = await setup();
    vi.useFakeTimers();
    try {
      let acknowledge: (value: unknown) => void = () => undefined;
      api.tabs.sendMessage = vi.fn(() => new Promise(resolve => { acknowledge = resolve; }));
      const first = background.runtime.apiResults.prepareClear(documentKey);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await first).toEqual({ ready: true, reset: false });
      const second = background.runtime.apiResults.prepareClear(documentKey);
      acknowledge({ schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 });
      expect(await second).toEqual({ ready: true, reset: false });
      expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(background.runtime.state.bindings.get('7:0')?.apiResultsResetRequired).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it.each(['document', 'session'] as const)('does not acknowledge %s clear when the final reset marker cannot be saved', async target => {
    const { api, background } = await setup(10000);
    const runtime = background.runtime;
    const save = runtime.repository.saveIndex.bind(runtime.repository);
    vi.spyOn(runtime.repository, 'saveIndex').mockImplementation(async index => {
      if (index.bindings.some(binding => binding.documentKey === documentKey && binding.apiResultsResetRequired === false)) return false;
      return save(index);
    });
    api.tabs.sendMessage = vi.fn(async () => ({ schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 }));
    try {
      const response = target === 'session' ? await runtime.clearSession()
        : await runtime.clear(7, documentKey, runtime.getProjection(7)!.reportRevision);
      expect(response).toMatchObject({ type: 'error', code: 'no-access' });
      expect(readStoredIndex(api.session.data.get('index'))?.bindings[0]?.apiResultsResetRequired).not.toBe(false);
    } finally { runtime.stop(); }
  });

  it('durably acknowledges session reset during commit cooldown and preserves new results across restart', async () => {
    const { api, background } = await setup(10000);
    const runtime = background.runtime;
    const commit = vi.spyOn(runtime.repository, 'commit').mockResolvedValue({ ok: false, failure: 'quota' });
    let restarted: Background | undefined;
    try {
      expect(await runtime.repository.run(documentKey, () => runtime.persistNow(documentKey))).toBe(false);
      expect(commit).toHaveBeenCalledTimes(3);
      commit.mockRestore();
      api.tabs.sendMessage = vi.fn(async () => ({ schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 }));
      expect(await runtime.clearSession()).toMatchObject({ type: 'ok' });
      expect(readStoredIndex(api.session.data.get('index'))?.bindings[0]?.apiResultsResetRequired).toBe(false);
      runtime.stop();
      api.tabs.sendMessage = vi.fn(async () => ({ ...cache, epoch: 1 }));
      restarted = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
      await restarted.start();
      expect(await send(restarted)).toMatchObject({ available: true, rows: [row] });
      expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(7, { schemaVersion: 1, type: 'api-results-reset' }, { frameId: 0, documentId });
    } finally { runtime.stop(); restarted?.runtime.stop(); }
  });

  it('saves the reset marker before deleting an evicted live document snapshot', async () => {
    const { background } = await setup();
    const order: string[] = [];
    const save = background.runtime.repository.saveIndex.bind(background.runtime.repository);
    vi.spyOn(background.runtime.repository, 'saveIndex').mockImplementation(async index => {
      const result = await save(index);
      if (index.evictedKeys?.includes(documentKey) || index.bindings.some(binding => binding.documentKey === documentKey && binding.apiResultsResetRequired)) order.push('reset-marker');
      return result;
    });
    vi.spyOn(background.runtime.repository, 'remove').mockImplementation(async () => { order.push('remove'); return true; });
    background.runtime.dispatch({ type: 'document:evict', documentKeys: [documentKey], at: background.runtime.now() });
    await vi.waitFor(() => expect(order).toContain('remove'));
    expect(order.indexOf('reset-marker')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('reset-marker')).toBeLessThan(order.indexOf('remove'));
  });

  it('requires reset when a restored binding has no matching persisted snapshot', async () => {
    const { api, background } = await setup();
    await background.runtime.flushIndex();
    api.session.data.delete('doc:' + documentKey);
    const restarted = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await restarted.start();
    api.tabs.sendMessage = vi.fn(async (_tabId, message) => (message as { type: string }).type === 'api-results-reset'
      ? { schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 } : { ...cache, rows: [], epoch: 1 });
    expect(await send(restarted)).toMatchObject({ available: true, rows: [] });
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, { schemaVersion: 1, type: 'api-results-reset' }, { frameId: 0, documentId });
  });

  it('does not reveal pre-pause results after resume when the live bridge missed the reset', async () => {
    const { api, background } = await setup();
    const report = background.runtime.getProjection(7)!;
    api.tabs.sendMessage = vi.fn(async () => cache);
    expect(await send(background, { schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey, reportRevision: report.reportRevision })).toMatchObject({ type: 'ok' });
    expect(background.runtime.state.bindings.get('7:0')?.apiResultsResetRequired).toBe(true);
    const paused = background.runtime.getProjection(7)!;
    expect(await send(background, { schemaVersion: 1, type: 'ui-resume', tabId: 7, documentKey, reportRevision: paused.reportRevision })).toMatchObject({ type: 'ok' });
    expect(await send(background)).toMatchObject({ available: false, rows: [] });
  });

  it('does not wait cyclically on sibling document queues after overlapping quota failures', async () => {
    const { background } = await setup(10000);
    const runtime = background.runtime;
    const firstKey = '7:1:child-a', secondKey = '7:2:child-b';
    for (const [frameId, childId] of [[1, 'child-a'], [2, 'child-b']] as const) runtime.dispatch({
      type: 'navigation:committed', tabId: 7, frameId, documentId: childId, parentDocumentId: documentId,
      frameType: 'sub_frame', documentLifecycle: 'active', host: 'example.com', scheme: 'https', accessGranted: true, at: runtime.now(),
    });
    let failFirst: () => void = () => undefined, failSecond: () => void = () => undefined;
    const firstCalls = new Set<string>();
    vi.spyOn(runtime.repository, 'commit').mockImplementation(async key => {
      if ((key === firstKey || key === secondKey) && !firstCalls.has(key)) {
        firstCalls.add(key);
        return new Promise(resolve => {
          const fail = () => resolve({ ok: false, failure: 'quota' } as const);
          if (key === firstKey) failFirst = fail;
          else failSecond = fail;
        });
      }
      return { ok: true };
    });
    try {
      const first = runtime.repository.run(firstKey, () => runtime.persistNow(firstKey));
      const second = runtime.repository.run(secondKey, () => runtime.persistNow(secondKey));
      await vi.waitFor(() => expect(firstCalls.size).toBe(2));
      failFirst();
      await vi.waitFor(() => expect(runtime.state.reports.has(secondKey)).toBe(false));
      failSecond();
      let finished = false;
      void Promise.all([first, second]).then(() => { finished = true; });
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 500 });
      expect(runtime.state.reports.has(firstKey)).toBe(true);
      expect(await second).toBe(false);
    } finally { runtime.stop(); }
  });
});