import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageBatch, PageObservation, TechniqueId } from '@detect-expert/contracts';
import { BadgeManager, countTabTechniques } from '../src/badge';
import { BADGE_LANGUAGE_KEY, badgeBrowserLanguage } from '../src/badge-label';
import type { BackgroundChromeApi } from '../src/chrome-api';
import { BackgroundRuntime } from '../src/runtime';
import { createInitialState, reduce } from '../src/documents';
import type { DocumentEvent, DocumentsState } from '../src/documents';
import { noopEngine } from '../src/engine-port';
import type { PageSenderContext } from '../src/sender';
import { committed, createFakeChrome } from './fake-chrome';

const TOP = 'DOC000000000000000000000000000001';
const CHILD = 'DOC000000000000000000000000000002';
const key = (documentId = TOP, frameId = 0, tabId = 7) => `${tabId}:${frameId}:${documentId}`;
const sender = (documentId = TOP, frameId = 0, tabId = 7): PageSenderContext => ({ tabId, frameId, documentId,
  documentKey: key(documentId, frameId, tabId), host: 'example.com', originPattern: 'https://example.com/*',
  frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active' });
const commit = (documentId = TOP, frameId = 0, parentDocumentId: string | null = null, tabId = 7): DocumentEvent => ({
  type: 'navigation:committed', documentId, frameId, parentDocumentId, tabId, frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame',
  documentLifecycle: 'active', host: 'example.com', scheme: 'https', accessGranted: true, at: 1_000_000 });
const observation = (techniqueId: TechniqueId, count = 1, phase: PageObservation['phase'] = 'returned-sync'): PageObservation => ({
  techniqueId, count, phase, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: 1 });
const batch = (observations: PageObservation[], seq = 1): PageBatch => ({ schemaVersion: 1, type: 'sensor-events',
  sensorBootId: 'badge-boot', bridgeSessionId: 'badge-bridge', batchSeq: seq, observations, coverageDelta: [] });
const apply = (state: DocumentsState, event: DocumentEvent) => reduce(state, event, noopEngine).state;
const networkEvent = (documentKey = key(), multiPort = false): DocumentEvent => ({ type: 'network:observed', documentKey,
  websocket: true, local: true, multiPort, limited: false, epoch: 'badge-network', at: 1_000_002 });
function observed(state = createInitialState(), documentId = TOP, frameId = 0, ids: TechniqueId[] = ['DET-001'], parent: string | null = null, tabId = 7): DocumentsState {
  state = apply(state, commit(documentId, frameId, parent, tabId));
  return apply(state, { type: 'batch', sender: sender(documentId, frameId, tabId), batch: batch(ids.map((id) => observation(id))), at: 1_000_001 });
}
function chrome() {
  const api = createFakeChrome();
  api.framesByTab.set(7, [committed()]);
  const text = new Map<number, string>();
  const calls = { text: vi.fn(async (d: { tabId: number; text: string }) => { text.set(d.tabId, d.text); }),
    background: vi.fn(async (_d: { tabId: number; color: string }): Promise<void> => undefined),
    color: vi.fn(async (_d: { tabId: number; color: string }): Promise<void> => undefined),
    title: vi.fn(async (_d: { tabId: number; title: string }): Promise<void> => undefined) };
  api.action = { setBadgeText: calls.text, setBadgeBackgroundColor: calls.background, setBadgeTextColor: calls.color, setTitle: calls.title };
  return { api, calls, text };
}

function languageEvents(api: BackgroundChromeApi) {
  type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const listeners = new Set<Listener>();
  api.storage.onChanged = {
    addListener: listener => { listeners.add(listener); },
    removeListener: listener => { listeners.delete(listener); },
  };
  return {
    listeners,
    emit(changes: Record<string, { newValue?: unknown }>, area = 'local') {
      for (const listener of listeners) listener(changes, area);
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ADR-021 current-tab observed technique union', () => {
  it('includes browser-only counters and deduplicates their patterns and frames', () => {
    let state = apply(observed(undefined, TOP, 0, []), networkEvent());
    expect(countTabTechniques(state, 7, () => true)).toBe(2);
    state = apply(state, networkEvent(key(), true));
    expect(countTabTechniques(state, 7, () => true)).toBe(2);
    state = observed(state, CHILD, 2, ['DET-005'], TOP);
    state = apply(state, networkEvent(key(CHILD, 2)));
    expect(countTabTechniques(state, 7, () => true)).toBe(3);
    state = apply(state, { type: 'batch', sender: sender(), batch: batch([observation('DET-058')], 2), at: 1_000_003 });
    expect(countTabTechniques(state, 7, () => true)).toBe(3);
  });

  it('keeps network history only for accessible current documents and honors reset and clear', () => {
    const state = apply(observed(undefined, TOP, 0, []), networkEvent());
    expect(countTabTechniques(state, 7, () => false)).toBe(0);
    expect(countTabTechniques(apply(state, { type: 'ui:pause', documentKey: key(), at: 1_000_003 }), 7, () => true)).toBe(2);
    for (const event of [
      { type: 'network:reset', documentKey: key(), at: 1_000_003 },
      { type: 'ui:clear', documentKey: key(), at: 1_000_003 },
      { type: 'scope:revoked', documentKeys: [key()], at: 1_000_003 },
      commit('replacement'),
    ] satisfies DocumentEvent[]) expect(countTabTechniques(apply(state, event), 7, () => true), event.type).toBe(0);
    expect(countTabTechniques(apply(state, { type: 'frames:retired', documentKeys: [key()], at: 1_000_003 }), 7, () => true)).toBe(2);
    const childOnly = apply(observed(observed(undefined, TOP, 0, []), CHILD, 2, [], TOP), networkEvent(key(CHILD, 2)));
    expect(countTabTechniques(childOnly, 7, () => true)).toBe(2);
    expect(countTabTechniques(apply(childOnly, { type: 'frames:retired', documentKeys: [key(CHILD, 2)], at: 1_000_003 }), 7, () => true)).toBe(0);
  });

  it('deduplicates methods, phases and frames; excludes zero counters, coverage IDs, findings and vendors', () => {
    let state = observed(undefined, TOP, 0, ['DET-001', 'DET-067', 'DET-068']);
    state = apply(state, { type: 'batch', sender: sender(), batch: batch([
      observation('DET-001', 700), observation('DET-001', 4, 'threw-sync'), observation('DET-002', 0),
    ], 2), at: 1_000_002 });
    state = observed(state, CHILD, 2, ['DET-001', 'DET-005'], TOP);
    expect(countTabTechniques(state, 7, () => true)).toBe(2);
    const report = state.reports.get(key())!;
    const reports = new Map(state.reports);
    reports.set(key(), { ...report, counters: [], hosts: [{ registrableDomain: 'cloudflare.com', relation: 'cross-site',
      evidenceSource: 'browser-network', integrity: 'browser-observed',
      ruleIds: ['turnstile-client-v1'], firstSeenBucket: 1, lastSeenBucket: 1, requestCount: 1 }] });
    state = { ...state, reports };
    state = apply(state, { type: 'frames:retired', documentKeys: [key(CHILD, 2)], at: 1_000_003 });
    expect(countTabTechniques(state, 7, () => true)).toBe(0);
  });

  it('requires an active current root and a complete active ancestry; rejects cycles and other-tab history', () => {
    let state = observed();
    state = observed(state, CHILD, 2, ['DET-005'], TOP);
    state = observed(state, 'nested', 3, ['DET-006'], CHILD);
    state = observed(state, 'orphan', 4, ['DET-008'], 'absent-parent');
    state = observed(state, 'other', 0, ['DET-025'], null, 8);
    expect(countTabTechniques(state, 7, () => true)).toBe(3);
    expect(countTabTechniques(state, 8, () => true)).toBe(1);
    const bindings = new Map(state.bindings);
    const child = bindings.get('7:2')!;
    bindings.set('7:2', { ...child, documentLifecycle: 'cached' });
    expect(countTabTechniques({ ...state, bindings }, 7, () => true)).toBe(1);
    bindings.set('7:2', { ...child, documentLifecycle: 'prerender' });
    expect(countTabTechniques({ ...state, bindings }, 7, () => true)).toBe(1);
    bindings.set('7:2', { ...child, parentDocumentId: 'nested' });
    expect(countTabTechniques({ ...state, bindings }, 7, () => true)).toBe(1);
    bindings.set('7:0', { ...bindings.get('7:0')!, documentLifecycle: 'cached' });
    expect(countTabTechniques({ ...state, bindings }, 7, () => true)).toBe(0);
  });

  it('retains paused history while accessible, and removes revoked/cleared/retired evidence', () => {
    const state = observed(observed(), CHILD, 2, ['DET-005'], TOP);
    const paused = apply(state, { type: 'ui:pause', documentKey: key(), at: 1_000_002 });
    expect(countTabTechniques(paused, 7, () => true)).toBe(2);
    expect(countTabTechniques(paused, 7, (id) => id !== key(CHILD, 2))).toBe(1);
    expect(countTabTechniques(paused, 7, (id) => id !== key())).toBe(0);
    for (const event of [
      { type: 'scope:revoked', documentKeys: [key(CHILD, 2)], at: 1_000_003 },
      { type: 'frames:retired', documentKeys: [key(CHILD, 2)], at: 1_000_003 },
      { type: 'document:evict', documentKeys: [key(CHILD, 2)], at: 1_000_003 },
      { type: 'ui:clear', documentKey: key(CHILD, 2), at: 1_000_003 },
    ] satisfies DocumentEvent[]) expect(countTabTechniques(apply(paused, event), 7, () => true)).toBe(1);
  });

  it('does not reuse replaced documents, even when their reports remain in history', () => {
    let state = observed(observed(), CHILD, 2, ['DET-005'], TOP);
    state = apply(state, commit('replacement'));
    expect(state.reports.has(key())).toBe(true);
    expect(countTabTechniques(state, 7, () => true)).toBe(0);
    state = observed(state, 'replacement', 0, ['DET-025']);
    expect(countTabTechniques(state, 7, () => true)).toBe(1);
  });
});

describe('ADR-021 native action scheduling', () => {
  it('updates the native badge for browser attempts and clears it after network reset', async () => {
    const { api, text } = chrome();
    let state = observed(undefined, TOP, 0, []);
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    const before = state;
    const event = networkEvent();
    state = apply(state, event);
    manager.afterEvent(event, before);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('2');
    const beforeReset = state;
    const reset: DocumentEvent = { type: 'network:reset', documentKey: key(), at: 1_000_003 };
    state = apply(state, reset);
    manager.afterEvent(reset, beforeReset);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    manager.stop();
  });

  it('uses the UI browser-language policy for unsupported and regional browser languages', async () => {
    expect(badgeBrowserLanguage('de-DE')).toBe('en');
    expect(badgeBrowserLanguage('zh-TW')).toBe('zh_CN');
    expect(badgeBrowserLanguage('pt-PT')).toBe('pt_BR');
    expect(badgeBrowserLanguage('PT_br')).toBe('pt_BR');
    expect(badgeBrowserLanguage('fr-CA')).toBe('fr');
    expect(badgeBrowserLanguage('hi-IN')).toBe('hi');
    expect(badgeBrowserLanguage('ur-PK')).toBe('ur');
    expect(badgeBrowserLanguage('ur-IN')).toBe('ur');
    expect(badgeBrowserLanguage('ja-JP')).toBe('ja');
    expect(badgeBrowserLanguage('__proto__')).toBe('en');
    const { api, calls } = chrome();
    api.i18n = { getUILanguage: () => 'de-DE', getMessage: () => 'Native manifest fallback is Russian' };
    const manager = new BadgeManager(api, observed, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7,
      title: 'Detect Expert — Observed techniques in this tab and its frames: 1' });
    manager.stop();
  });

  it('loads the saved language and updates an unchanged count on preference changes, restoring the browser locale on removal', async () => {
    const { api, calls, text } = chrome();
    const changes = languageEvents(api);
    api.local.data.set(BADGE_LANGUAGE_KEY, 'ar');
    api.i18n = { getMessage: (_name, n) => 'Native browser language ' + n };
    const state = observed();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7,
      title: 'Detect Expert — التقنيات المرصودة في علامة التبويب هذه وإطاراتها: 1' });

    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: 'vi' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7,
      title: 'Detect Expert — Số kỹ thuật được ghi nhận trong thẻ này và các khung: 1' });
    expect(calls.title).toHaveBeenCalledTimes(2);
    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: 'en' } }, 'session');
    changes.emit({ unrelated: { newValue: 'en' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenCalledTimes(2);

    changes.emit({ [BADGE_LANGUAGE_KEY]: {} });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7, title: 'Detect Expert — Native browser language 1' });
    expect(text.get(7)).toBe('1');
    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: 'zh_CN' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7,
      title: 'Detect Expert — 此标签页及其框架中观察到的技术数：1' });
    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: { locale: 'ar' } } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7, title: 'Detect Expert — Native browser language 1' });
    manager.stop();
    expect(changes.listeners.size).toBe(0);
    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: 'zh_CN' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.title).toHaveBeenCalledTimes(5);
  });

  it('does not let a delayed initial language read overwrite a newer storage event', async () => {
    const { api, calls, text } = chrome();
    const changes = languageEvents(api);
    let release!: (value: Record<string, unknown>) => void;
    vi.spyOn(api.local, 'get').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    api.i18n = { getMessage: (_name, n) => 'Native browser language ' + n };
    const state = observed();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7, title: 'Detect Expert — Native browser language 1' });
    changes.emit({ [BADGE_LANGUAGE_KEY]: { newValue: 'zh_CN' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.title).toHaveBeenLastCalledWith({ tabId: 7,
      title: 'Detect Expert — 此标签页及其框架中观察到的技术数：1' });
    release({ [BADGE_LANGUAGE_KEY]: 'ar' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.title).toHaveBeenCalledTimes(2);
    expect(text.get(7)).toBe('1');
    expect(vi.getTimerCount()).toBe(0);
    manager.stop();
  });

  it('coalesces bursts at 250ms, localizes the title, hides zero and suppresses unchanged repaints', async () => {
    const { api, calls, text } = chrome();
    api.tabList = [{ id: 7 }, { id: 8 }];
    api.i18n = { getMessage: vi.fn((_name, n) => 'Наблюдаемых техник: ' + n) };
    let state = observed();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    for (let i = 0; i < 100; i++) manager.mark(7);
    await vi.advanceTimersByTimeAsync(249);
    expect(calls.text).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(text).toEqual(new Map([[7, '1'], [8, '']]));
    expect(calls.background).toHaveBeenCalledWith({ tabId: 7, color: '#DC2626' });
    expect(calls.color).toHaveBeenCalledWith({ tabId: 7, color: '#FFFFFF' });
    expect(calls.title).toHaveBeenCalledWith({ tabId: 7, title: 'Detect Expert — Наблюдаемых техник: 1' });
    for (let i = 0; i < 100; i++) manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.text).toHaveBeenCalledTimes(2);
    state = apply(state, { type: 'ui:clear', documentKey: key(), at: 1_000_002 });
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    manager.stop();
  });

  it('repairs a late old native write after clear even when zero was previously cached', async () => {
    const { api, calls, text } = chrome();
    api.tabList = [{ id: 7 }];
    let state = createInitialState();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    calls.text.mockImplementationOnce(async (d) => { await pending; text.set(d.tabId, d.text); });
    state = observed();
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    state = createInitialState();
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.text).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    expect(calls.text).toHaveBeenCalledTimes(3);
    manager.stop();
  });

  it('checks live browser frames on activity so silent child removal lowers the badge without mutating reports', async () => {
    const { api, text } = chrome();
    const childFrame = committed({ frameId: 2, documentId: CHILD, parentDocumentId: TOP, frameType: 'sub_frame' });
    api.framesByTab.set(7, [committed(), childFrame]);
    const state = observed(observed(), CHILD, 2, ['DET-005'], TOP);
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('2');
    api.framesByTab.set(7, [committed()]);
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    expect(state.reports.get(key(CHILD, 2))!.counters[0]!.techniqueId).toBe('DET-005');
    expect(state.bindings.has('7:2')).toBe(true);
    manager.stop();
  });

  it('does not turn failed enumeration into a false zero; an explicit clear still clears', async () => {
    const { api, text } = chrome();
    let state = observed();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    api.webNavigation.getAllFrames = async () => { throw new Error('unavailable'); };
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    state = createInitialState();
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    manager.stop();
  });

  it('stops stale multi-call work between awaits and never repaints a removed tab', async () => {
    const { api, calls } = chrome();
    let release!: () => void;
    calls.background.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const state = observed();
    const manager = new BadgeManager(api, () => state, () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(250);
    manager.afterEvent({ type: 'tab:removed', tabId: 7, at: 1_000_001 }, state);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.title).not.toHaveBeenCalled();
    expect(calls.text).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    manager.stop();
  });

  it('bounds physical unresolved calls across repeated updates and tab floods without polling', async () => {
    const { api, calls } = chrome();
    calls.background.mockImplementation(() => new Promise<void>(() => undefined));
    const manager = new BadgeManager(api, createInitialState, () => true);
    manager.start();
    for (let i = 0; i < 10_000; i++) manager.mark(i);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.background).toHaveBeenCalledTimes(4);
    expect(calls.text).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    manager.stop();
  });

  it('isolates native failures and retries only on a later event, with an English fallback', async () => {
    const { api, calls, text } = chrome();
    calls.background.mockImplementationOnce(() => { throw new Error('tab gone'); });
    calls.color.mockRejectedValueOnce(new Error('unavailable'));
    api.i18n = { getMessage: () => { throw new Error('locale unavailable'); } };
    const manager = new BadgeManager(api, () => observed(), () => true);
    manager.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(text.get(7)).toBe('1');
    expect(calls.text).toHaveBeenCalledTimes(1);
    expect(calls.title).toHaveBeenCalledWith({ tabId: 7, title: 'Detect Expert — Observed techniques in this tab and its frames: 1' });
    manager.mark(7);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.text).toHaveBeenCalledTimes(2);
    manager.stop();
  });
});

describe('ADR-021 runtime lifecycle and restart', () => {
  async function start() {
    const c = chrome();
    c.api.grantedOrigins.add('https://example.com/*');
    c.api.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    c.api.tabList = [{ id: 7 }, { id: 8 }];
    c.api.framesByTab.set(7, [committed()]);
    c.api.framesByTab.set(8, []);
    const runtime = new BackgroundRuntime(c.api, { clock: { now: () => 1_000_000 }, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await runtime.start();
    await runtime.handleBatch(sender(), batch([observation('DET-001')]));
    await vi.advanceTimersByTimeAsync(500);
    return { ...c, runtime };
  }

  it('updates without popup reads; pause keeps history, document/session clear and revoke remove it', async () => {
    const { api, text, runtime } = await start();
    expect(text.get(7)).toBe('1');
    await runtime.pause(7, key(), runtime.state.reports.get(key())!.revision);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    await runtime.clear(7, key(), runtime.state.reports.get(key())!.revision);
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    await runtime.handleBatch(sender(), batch([observation('DET-005')], 2));
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    await runtime.clearSession();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    await runtime.handleBatch(sender(), batch([observation('DET-001')], 3));
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('1');
    api.grantedOrigins.clear();
    await runtime.onPermissionsChanged();
    await vi.advanceTimersByTimeAsync(250);
    expect(text.get(7)).toBe('');
    runtime.stop();
  });

  it('rebuilds persisted current-tab counts after SW restart and clears stale empty-tab badges', async () => {
    const { api, text, runtime } = await start();
    runtime.stop();
    text.set(7, '99');
    text.set(8, '99');
    const next = new BackgroundRuntime(api, { clock: { now: () => 1_000_000 }, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(text.get(7)).toBe('1');
    expect(text.get(8)).toBe('');
    next.stop();
  });
});
