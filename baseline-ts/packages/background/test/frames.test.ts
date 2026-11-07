// P06 / REQ-006/009: inaccessible child frames affect only their browser-bound active ancestors.
import { describe, expect, it } from 'vitest';
import { BackgroundRuntime, createInitialState, noopEngine, reduce } from '../src/index';
import type { DocumentEvent, DocumentsState, PageSenderContext } from '../src/index';
import { createFakeChrome } from './fake-chrome';

const TOP = 'p06top';
const CHILD = 'p06child';
const key = (documentId: string, frameId = 0) => '7:' + frameId + ':' + documentId;
const commit = (documentId: string, frameId: number, parentDocumentId: string | null, accessGranted = true,
  lifecycle: 'active' | 'prerender' = 'active'): DocumentEvent => ({ type: 'navigation:committed', tabId: 7, frameId,
  documentId, parentDocumentId, documentLifecycle: lifecycle, frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame',
  host: 'example.com', accessGranted, at: 1000 });
const sender = (documentId: string, frameId: number): PageSenderContext => ({ tabId: 7, frameId, documentId,
  documentKey: key(documentId, frameId), host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: null });
const batch = (documentId: string, frameId: number, diagnostic = false): DocumentEvent => ({ type: 'batch',
  sender: sender(documentId, frameId), at: 2000, batch: { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'p06boot',
    bridgeSessionId: 'p06bridge', batchSeq: 1, coverageDelta: diagnostic ? ['hook-failed'] : [],
    observations: diagnostic ? [] : [{ techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 1 }] } });
const apply = (state: DocumentsState, event: DocumentEvent) => reduce(state, event, noopEngine).state;
function topState(): DocumentsState {
  return apply(apply(createInitialState(), commit(TOP, 0, null)), batch(TOP, 0));
}

describe('P06: frame coverage propagation', () => {
  it('denied child degrades its observed parent while keeping child data separate', () => {
    const state = apply(topState(), commit(CHILD, 2, TOP, false));
    expect(state.reports.get(key(TOP))).toMatchObject({ coverageState: 'partial', coverageFlags: ['frames-inaccessible'] });
    expect(state.reports.get(key(TOP))?.counters[0]?.count).toBe(1);
    expect(state.reports.get(key(CHILD, 2))).toMatchObject({ coverageState: 'no-access', counters: [] });
  });

  it('healthy granted child cannot degrade or add counts to its parent', () => {
    const state = apply(apply(topState(), commit(CHILD, 2, TOP)), batch(CHILD, 2));
    expect(state.reports.get(key(TOP))).toMatchObject({ coverageState: 'active', coverageFlags: [] });
    expect(state.reports.get(key(TOP))?.counters[0]?.count).toBe(1);
  });

  it('coverage-only failed child sensor propagates a gap without fabricating an observation', () => {
    const state = apply(apply(topState(), commit(CHILD, 2, TOP)), batch(CHILD, 2, true));
    expect(state.reports.get(key(TOP))).toMatchObject({ coverageState: 'partial', coverageFlags: ['frames-inaccessible'] });
    expect(state.reports.get(key(CHILD, 2))?.counters).toEqual([]);
  });

  it('a nested gap reaches both active ancestors and retains idempotent report revisions', () => {
    let state = apply(topState(), commit(CHILD, 2, TOP));
    state = apply(state, commit('p06nested', 3, CHILD, false));
    expect(state.reports.get(key(TOP))?.coverageFlags).toContain('frames-inaccessible');
    expect(state.reports.get(key(CHILD, 2))?.coverageFlags).toContain('frames-inaccessible');
    const revision = state.reports.get(key(TOP))?.revision;
    state = apply(state, { type: 'frame:unavailable', tabId: 7, frameId: 3, documentId: 'p06nested', at: 2500 });
    expect(state.reports.get(key(TOP))?.revision).toBe(revision);
  });

  it('stale identity after frame reuse cannot mark the replacement parent', () => {
    let state = apply(topState(), commit(CHILD, 2, TOP));
    state = apply(state, commit('replacement', 2, TOP));
    state = apply(state, { type: 'frame:unavailable', tabId: 7, frameId: 2, documentId: CHILD, at: 2500 });
    expect(state.reports.get(key(TOP))?.coverageFlags).toEqual([]);
  });

  it('prerender child gaps never modify the visible active document', () => {
    const state = apply(topState(), commit(CHILD, 2, TOP, false, 'prerender'));
    expect(state.reports.get(key(TOP))).toMatchObject({ coverageState: 'active', coverageFlags: [] });
  });

  it('scope narrowing of a child reveals the gap but never restores access to its parent', () => {
    let state = apply(topState(), commit(CHILD, 2, TOP));
    state = apply(state, { type: 'scope:access', documentKey: key(CHILD, 2), host: null, accessGranted: false, at: 2000 });
    expect(state.reports.get(key(TOP))?.coverageFlags).toContain('frames-inaccessible');
    state = apply(state, { type: 'scope:revoked', documentKeys: [key(TOP)], at: 2500 });
    state = apply(state, { type: 'frame:unavailable', tabId: 7, frameId: 2, documentId: CHILD, at: 3000 });
    expect(state.reports.get(key(TOP))).toMatchObject({ coverageState: 'no-access', coverageFlags: ['revoked'], counters: [] });
  });

  it('trusted child gap remains visible when the top document made no canvas calls', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0 });
    await runtime.start();
    runtime.dispatch(commit(TOP, 0, null));
    runtime.dispatch({ ...commit(CHILD, 2, TOP, false), host: 'ungranted.example' } as DocumentEvent);
    expect(runtime.getProjection(7)).toMatchObject({ coverageState: 'partial', coverageFlags: expect.arrayContaining(['frames-inaccessible', 'network-limited']), techniques: [] });
    expect(runtime.getProjection(7)?.coverageFlags).not.toContain('no-host-permission');
    runtime.stop();
  });
});
