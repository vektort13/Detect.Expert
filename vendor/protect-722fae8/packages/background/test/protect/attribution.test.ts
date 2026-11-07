// ADR-020 §F (S10): the SW attribution service — correlation of relayed MAIN samples with webRequest requests, the
// port (attributionFor / onResolved / scriptActivity), password-field-listener facts, memory bounds. The document key
// comes from MessageSender only; nothing is stored outside SW memory except the listener fact (doc-store, value-free).

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, makeDocumentKey } from '@detect-expert/contracts';
import type { ProtectEventsMessage, ProtectListenerEvidence, RegistrationSampleSw, ScriptAttribution, ScriptRef, SendSampleSw } from '@detect-expert/contracts';
import type { RequestDetailsLike } from '../../src/chrome-api';
import { createAttributionService, SETTLE_MS } from '../../src/protect/attribution/index';
import type { AttributionPort, AttributionService } from '../../src/protect/attribution/index';
import { ProtectDocStore } from '../../src/protect/doc-store';
import { ProtectEventBus } from '../../src/protect/event-bus';
import type { ProtectEvent } from '../../src/protect/event-bus';
import { EMPTY_PROTECT_TABLES } from '../../src/protect/services';
import type { ProtectServiceContext } from '../../src/protect/services';
import { ProtectTabModel } from '../../src/protect/tab-model';
import type { PageSenderContext } from '../../src/sender';
import { createFakeChrome } from '../fake-chrome';
import { makeClock } from './support';

const T0 = 1_700_000_000_000;
const TAB = 7;
const TOP = 'TOPDOC1';
const TOP_KEY = makeDocumentKey(TAB, 0, TOP);
const CDN: ScriptRef = { kind: 'external', scheme: 'https', host: 'cdn.tracker-a.example.org', pathTemplate: '/lib/v2/collect.js' };
const OTHER: ScriptRef = { kind: 'external', scheme: 'https', host: 'cdn.other.example.net', pathTemplate: '/o.js' };

function setup(options: { excluded?: boolean } = {}) {
  const fake = createFakeChrome();
  const clock = makeClock(T0);
  const tabModel = new ProtectTabModel(clock);
  tabModel.noteCommitted({ tabId: TAB, frameId: 0, documentId: TOP, url: 'https://shop.example.com/checkout', timeStamp: T0 });
  const docStore = new ProtectDocStore(fake.session, clock, () => true, { flushMs: 1 });
  docStore.ensure(TOP_KEY, TAB); // the top document's record exists from its commit (createdAt = T0)
  const eventBus = new ProtectEventBus();
  const events: ProtectEvent[] = [];
  eventBus.subscribe(null, (e) => events.push(e));
  const ports = { firewallEvaluate: () => null, attribution: null as unknown, pendingCount: () => 0 };
  const ctx = {
    db: null,
    docStore,
    tabModel,
    eventBus,
    dnrPort: null,
    netHub: null,
    outcomes: null,
    clock,
    tables: EMPTY_PROTECT_TABLES,
    ports,
    testProfile: true,
    settings: () => ({}),
    isExcluded: () => options.excluded === true,
    isTabExcluded: () => options.excluded === true,
    sendControl: () => undefined,
  } as unknown as ProtectServiceContext;
  let ids = 0;
  const service = createAttributionService({ setTimer: () => 0, clearTimer: () => undefined, evidenceId: () => 'pe-t' + String(++ids) });
  service.start(ctx);
  const port = ports.attribution as AttributionPort;
  const resolved: Array<[string, ScriptAttribution]> = [];
  port.onResolved((id, _doc, a) => resolved.push([id, a]));
  return { fake, clock, service, port, ports, docStore, events, resolved, tabModel };
}

function sender(frameId = 0, documentId = TOP, host = 'shop.example.com'): PageSenderContext {
  return { tabId: TAB, frameId, documentId, documentKey: makeDocumentKey(TAB, frameId, documentId), host, originPattern: 'https://' + host + '/*', documentLifecycle: 'active', frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame' };
}

let seq = 0;
function sendSample(ageMs: number, over: Partial<SendSampleSw> = {}): SendSampleSw {
  return { hookPoint: 'send-fetch', sensorSeq: ++seq, script: CDN, sampled: true, target: { kind: 'absolute', host: 'collect.example.net' }, ageMs, ...over };
}

function events(sends: SendSampleSw[], over: Partial<ProtectEventsMessage> = {}, registrations: RegistrationSampleSw[] = []): ProtectEventsMessage {
  return { schemaVersion: 1, type: 'protect-events', sensorBootId: 'boot-a', relaySessionId: 'relay-a', batchSeq: 1, sends, registrations, dropped: { sends: 0, registrations: 0, unsampled: 0 }, limitations: [], ...over };
}

function request(requestId: string, t: number, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { requestId, tabId: TAB, frameId: 0, documentId: TOP, url: 'https://collect.example.net/v1/e?email=x', type: 'xmlhttprequest', timeStamp: t, initiator: 'https://shop.example.com', method: 'POST', ...over };
}

const ctxReq = { resolved: null };

describe('lifecycle and port', () => {
  it('publishes the port on start and withdraws it on stop; memory is cleared', () => {
    const s = setup();
    expect(s.ports.attribution).toBe(s.service.port);
    s.service.onSendHeaders(request('r1', T0), ctxReq);
    expect(s.port.attributionFor('r1')?.correlation).toBe('pending');
    s.service.stop('feature-off');
    expect(s.ports.attribution).toBeNull();
    expect(s.port.attributionFor('r1')).toBeNull();
  });
});

describe('correlation', () => {
  it('unique: request first, sample later; decided after the settle delay; sampled-stack with site, relation and script load', () => {
    seq = 0;
    const s = setup();
    s.service.onSendHeaders(request('s1', T0 - 50, { type: 'script', url: 'https://cdn.tracker-a.example.org/lib/v2/collect.js?v=3', requestId: 's1' }), ctxReq);
    s.service.onSendHeaders(request('r1', T0 + 10), ctxReq);
    s.service.onRequest(request('r1', T0 + 10), ctxReq); // armed tab: the same request again (de-duplicated)
    s.clock.t = T0 + 300;
    s.service.onPageMessage(sender(), events([sendSample(300)]));
    expect(s.port.attributionFor('r1')?.correlation).toBe('pending');
    s.clock.t = T0 + 10 + SETTLE_MS;
    s.service.tick();
    const a = s.port.attributionFor('r1');
    expect(a).toEqual({
      script: CDN,
      scriptSite: 'example.org',
      scriptRelation: 'cross-site',
      attributionConfidence: 'sampled-stack',
      evidenceSource: 'page-hook',
      integrity: 'page-controlled',
      correlation: 'unique',
      scriptLoadObserved: true,
      limitationCodes: ['nearest-frame-only'],
    });
    expect(s.resolved).toEqual([['r1', a]]);
    expect(s.service.debug()).toMatchObject({ requests: 1, unique: 1 });
  });

  it('sample first, request later works the same; a request of another document does not pair', () => {
    seq = 0;
    const s = setup();
    s.service.onPageMessage(sender(), events([sendSample(0)]));
    s.service.onSendHeaders(request('r1', T0 + 30), ctxReq);
    s.service.onSendHeaders(request('r2', T0 + 30, { frameId: 3, documentId: 'FRAME' }), ctxReq);
    s.clock.t = T0 + 3000;
    s.service.tick();
    expect(s.port.attributionFor('r1')?.correlation).toBe('unique');
    expect(s.port.attributionFor('r2')).toMatchObject({ correlation: 'none', script: null, attributionConfidence: 'unknown', limitationCodes: ['no-script-attribution'] });
  });

  it('ambiguous: two scripts sent to the same receiver within 150 ms', () => {
    seq = 0;
    const s = setup();
    s.service.onPageMessage(sender(), events([sendSample(0), sendSample(0, { script: OTHER })]));
    s.service.onSendHeaders(request('a', T0 + 5), ctxReq);
    s.service.onSendHeaders(request('b', T0 + 6), ctxReq);
    s.clock.t = T0 + 1000;
    s.service.tick();
    for (const id of ['a', 'b']) expect(s.port.attributionFor(id)).toMatchObject({ correlation: 'ambiguous', script: null, attributionConfidence: 'unknown', limitationCodes: ['correlation-ambiguous'] });
  });

  it('none (with MAIN events seen) / gap (dropped sends) / saturated (64/64 pending sends)', () => {
    seq = 0;
    const none = setup();
    none.service.onPageMessage(sender(), events([sendSample(0, { target: { kind: 'absolute', host: 'elsewhere.example.org' } })]));
    none.service.onSendHeaders(request('r', T0), ctxReq);
    none.clock.t = T0 + PROTECT_BUDGETS.attributionWaitMs;
    none.service.tick();
    expect(none.port.attributionFor('r')).toMatchObject({ correlation: 'none', limitationCodes: ['no-call-sample'] });

    const gap = setup();
    gap.service.onPageMessage(sender(), events([], { dropped: { sends: 3, registrations: 0, unsampled: 0 } }));
    gap.service.onSendHeaders(request('r', T0), ctxReq);
    gap.clock.t = T0 + PROTECT_BUDGETS.attributionWaitMs;
    gap.service.tick();
    expect(gap.port.attributionFor('r')).toMatchObject({ correlation: 'gap', limitationCodes: ['correlation-gap'] });

    const sat = setup();
    const many = Array.from({ length: PROTECT_BUDGETS.maxPendingSendsPerDocument + 1 }, () => sendSample(0, { target: { kind: 'absolute', host: 'other.example.org' } }));
    sat.service.onPageMessage(sender(), events(many.slice(0, 32)));
    sat.service.onPageMessage(sender(), events(many.slice(32), { batchSeq: 2 }));
    sat.service.onSendHeaders(request('r', T0), ctxReq);
    sat.clock.t = T0 + PROTECT_BUDGETS.attributionWaitMs;
    sat.service.tick();
    expect(sat.port.attributionFor('r')).toMatchObject({ correlation: 'saturated', limitationCodes: ['correlation-saturated'] });
  });

  it('a sequence gap of sends or of relay batches counts as a gap; replayed samples never pair twice', () => {
    seq = 0;
    const s = setup();
    s.service.onPageMessage(sender(), events([sendSample(0, { target: { kind: 'absolute', host: 'x.example.org' } })]));
    seq += 5; // samples 2..6 lost on the way
    s.service.onPageMessage(sender(), events([sendSample(0, { target: { kind: 'absolute', host: 'x.example.org' } })], { batchSeq: 2 }));
    s.service.onSendHeaders(request('r', T0), ctxReq);
    s.clock.t = T0 + PROTECT_BUDGETS.attributionWaitMs;
    s.service.tick();
    expect(s.port.attributionFor('r')?.correlation).toBe('gap');
    const replay = setup();
    const one = sendSample(0);
    replay.service.onPageMessage(sender(), events([one]));
    replay.service.onPageMessage(sender(), events([one], { batchSeq: 2 }));
    expect(replay.service.debug()).toMatchObject({ rejectedSamples: 1 });
  });

  it('unique pair without a usable stack: stack-budget / stack-unavailable, unread target noted', () => {
    seq = 0;
    const s = setup();
    s.service.onPageMessage(sender(), events([sendSample(0, { sampled: false, script: { kind: 'unknown' }, target: { kind: 'unread' } })]));
    s.service.onSendHeaders(request('r', T0 + 5), ctxReq);
    s.clock.t = T0 + 1000;
    s.service.tick();
    expect(s.port.attributionFor('r')).toMatchObject({ correlation: 'unique', script: null, attributionConfidence: 'unknown', limitationCodes: ['stack-budget', 'target-unread'] });
  });

  it('beacon pairs with ping, not with xmlhttprequest; excluded tabs are ignored', () => {
    seq = 0;
    const s = setup();
    s.service.onPageMessage(sender(), events([sendSample(0, { hookPoint: 'send-beacon' })]));
    s.service.onSendHeaders(request('x', T0 + 5), ctxReq);
    s.service.onSendHeaders(request('p', T0 + 6, { type: 'ping' }), ctxReq);
    s.clock.t = T0 + 3000;
    s.service.tick();
    expect(s.port.attributionFor('p')?.correlation).toBe('unique');
    expect(s.port.attributionFor('x')?.correlation).toBe('none');
    const ex = setup({ excluded: true });
    ex.service.onSendHeaders(request('r', T0), ctxReq);
    expect(ex.port.attributionFor('r')).toBeNull();
  });
});

describe('script activity and password-field-listener facts', () => {
  it('folds registrations per script (≤ 32) and records a low-confidence fact for a password-field input listener', () => {
    seq = 0;
    const s = setup();
    const regs: RegistrationSampleSw[] = [
      { hookPoint: 'listen', eventCode: 'input', targetKind: 'field-password', script: CDN, sampled: true, count: 2, ageMs: 0 },
      { hookPoint: 'listen', eventCode: 'focusin', targetKind: 'field-password', script: CDN, sampled: true, count: 1, ageMs: 0 },
      { hookPoint: 'listen', eventCode: 'keydown', targetKind: 'document', script: { kind: 'unknown' }, sampled: false, count: 4, ageMs: 0 },
      { hookPoint: 'observe-document', targetKind: 'root', script: CDN, sampled: true, count: 1, ageMs: 0 },
    ];
    s.clock.t = T0 + 4200;
    s.service.onPageMessage(sender(), events([], {}, regs));
    expect(s.port.scriptActivity(TOP_KEY)).toEqual([
      { script: CDN, scriptSite: 'example.org', hookPoints: ['listen', 'observe-document'], eventCodes: ['input', 'focusin'], targetKinds: ['root', 'field-password'], count: 4, sampledCount: 4, countQuality: 'exact' },
      { script: { kind: 'unknown' }, scriptSite: null, hookPoints: ['listen'], eventCodes: ['keydown'], targetKinds: ['document'], count: 4, sampledCount: 0, countQuality: 'exact' },
    ]);
    const evidence = s.docStore.doc(TOP_KEY)?.evidence as ProtectListenerEvidence[];
    expect(evidence).toEqual([
      {
        evidenceId: 'pe-t1',
        frameContext: 'top',
        script: CDN,
        attributionConfidence: 'sampled-stack',
        count: 2,
        countQuality: 'exact',
        firstSecond: 4,
        lastSecond: 4,
        evidenceSource: 'derived',
        integrity: 'derived',
        ruleVersion: '1',
        limitationCodes: ['nearest-frame-only'],
        protectKind: 'password-field-listener',
        ruleId: 'password-listener',
        interpretationConfidence: 'low',
      },
    ]);
    expect(s.events.filter((e) => e.kind === 'evidence')).toHaveLength(1);
    // The same fact again merges (count), a cross-site frame gets its own record.
    s.service.onPageMessage(sender(), events([], { batchSeq: 2 }, [regs[0]!]));
    s.service.onPageMessage(sender(2, 'FRAMEDOC', 'login.idp.example.net'), events([], { relaySessionId: 'relay-f' }, [{ ...regs[0]!, script: { kind: 'unknown' }, sampled: false }]));
    const after = s.docStore.doc(TOP_KEY)?.evidence as ProtectListenerEvidence[];
    expect(after.map((e) => [e.frameContext, e.frameSite ?? null, e.count, e.attributionConfidence, e.limitationCodes])).toEqual([
      ['top', null, 4, 'sampled-stack', ['nearest-frame-only']],
      ['cross-site-frame', 'example.net', 2, 'unknown', ['stack-budget']],
    ]);
    expect(JSON.stringify(after)).not.toMatch(/value|password"|secret/i);
  });

  it('bounded: at most 32 documents (LRU) and pending requests of an evicted document are decided as saturated', () => {
    seq = 0;
    const s = setup();
    s.service.onSendHeaders(request('first', T0), ctxReq);
    for (let i = 0; i < PROTECT_BUDGETS.maxCorrelationDocuments; i++) s.service.onSendHeaders(request('q' + String(i), T0, { frameId: i + 1, documentId: 'D' + String(i) }), ctxReq);
    expect(s.service.debug()['docs']).toBe(PROTECT_BUDGETS.maxCorrelationDocuments);
    expect(s.port.attributionFor('first')?.correlation).toBe('saturated');
  });
});
