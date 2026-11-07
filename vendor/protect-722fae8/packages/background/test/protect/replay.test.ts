// ADR-020 §E (S11): the SW session-recording lane — registrations (S1 / S2, page-controlled, document key from
// MessageSender only), cadence of cross-site sends (S3; body size only for armed tabs, only as a bucket), the replay
// table (S5; synthetic in the test profile only), levels in the projection, the storage.session section, the
// `replay-pattern` history event, SW restart (cadence-reset), late start (loaded-before-enable), feature off, the
// attribution-port seed and memory bounds. Nothing of a body, URL, query or value reaches any output.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { makeDocumentKey } from '@detect-expert/contracts';
import type { ProtectEventsMessage, ProtectProjection, ProtectReplayEvidence, ReplaySummary, RegistrationSampleSw, ScriptActivityEntry, ScriptRef } from '@detect-expert/contracts';
import type { RequestDetailsLike } from '../../src/chrome-api';
import { ProtectController } from '../../src/protect/controller';
import { ProtectDocStore } from '../../src/protect/doc-store';
import { ProtectEventBus } from '../../src/protect/event-bus';
import type { ProtectEvent } from '../../src/protect/event-bus';
import { MAX_REPLAY_FRAMES, ReplayService, createReplayService, replayBodyBytes } from '../../src/protect/replay/index';
import { EMPTY_PROTECT_TABLES } from '../../src/protect/services';
import type { ProtectServiceContext, ProtectTables } from '../../src/protect/services';
import { ProtectTabModel } from '../../src/protect/tab-model';
import type { PageSenderContext } from '../../src/sender';
import { committed, createFakeChrome } from '../fake-chrome';
import { ALL_SITES, ENABLED_SETTINGS, makeClock, popupSender } from './support';
import { MemoryProtectDb } from './memory-db';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'contracts', 'schemas');
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(join(schemasDir, 'common.v1.schema.json'), 'utf8')) as Record<string, unknown>);
const validateResponse = ajv.compile(JSON.parse(readFileSync(join(schemasDir, 'ui-response.v1.schema.json'), 'utf8')) as Record<string, unknown>);
const validateEvidence = ajv.compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/protectReplayEvidence' });

const T0 = 1_700_000_000_000;
const TAB = 7;
const TOP = 'TOPDOC00000000000000000000000001';
const TOP_KEY = makeDocumentKey(TAB, 0, TOP);
const SHOP = 'shop.example.com';
const SIM: ScriptRef = { kind: 'external', scheme: 'https', host: 'shop.example.com', pathTemplate: '/protect/replay/replay-sim.js' };
const REC: ScriptRef = { kind: 'external', scheme: 'https', host: 'rec.example.net', pathTemplate: '/rec.js' };
const CANARY = 'replay-canary-7f3a9c@example.org';
const SYNTHETIC: ProtectTables = {
  ...EMPTY_PROTECT_TABLES,
  REPLAY_ENTRIES: [
    { ruleId: 'test-replay-loader', vendorId: 'test-replay', role: 'resource', conditions: { scheme: 'http', hostExact: '127.0.0.1', portExact: 4174, pathExact: '/replay/loader.js' }, synthetic: true },
    { ruleId: 'test-replay-collect', vendorId: 'test-replay', role: 'endpoint', conditions: { scheme: 'http', hostExact: 'collect.replay.example.org', portExact: 4174, pathExact: '/replay/collect' }, synthetic: true },
  ],
};

interface Setup {
  clock: { t: number; now(): number };
  service: ReplayService;
  ctx: ProtectServiceContext;
  tabModel: ProtectTabModel;
  docStore: ProtectDocStore;
  events: ProtectEvent[];
  ports: { attribution: unknown };
  armed: Set<number>;
  excluded: { value: boolean };
}

interface SetupOptions {
  hooks?: { listen: boolean; observe: boolean };
  tables?: ProtectTables;
  testProfile?: boolean;
  /** The tab's top document committed before the lane started. */
  committedBefore?: boolean;
  docStore?: ProtectDocStore;
  attribution?: unknown;
}

function setup(o: SetupOptions = {}): Setup {
  const fake = createFakeChrome();
  const clock = makeClock(T0);
  const tabModel = new ProtectTabModel(clock);
  if (o.committedBefore === true) clock.t = T0 - 60_000;
  tabModel.noteCommitted({ tabId: TAB, frameId: 0, documentId: TOP, url: 'https://' + SHOP + '/checkout', timeStamp: clock.t });
  clock.t = T0;
  const docStore = o.docStore ?? new ProtectDocStore(fake.session, clock, () => true, { flushMs: 1 });
  const eventBus = new ProtectEventBus();
  const events: ProtectEvent[] = [];
  eventBus.subscribe(null, (e) => events.push(e));
  const ports = { firewallEvaluate: () => null, attribution: o.attribution ?? null, pendingCount: () => 0 };
  const armed = new Set<number>();
  const excluded = { value: false };
  const ctx = {
    db: null,
    docStore,
    tabModel,
    eventBus,
    dnrPort: null,
    netHub: { isArmed: (tabId: number) => armed.has(tabId) },
    outcomes: null,
    clock,
    tables: o.tables ?? EMPTY_PROTECT_TABLES,
    ports,
    testProfile: o.testProfile ?? true,
    settings: () => ({}),
    isExcluded: () => excluded.value,
    isTabExcluded: () => excluded.value,
    excludedSites: () => [],
    sendControl: () => undefined,
  } as unknown as ProtectServiceContext;
  let ids = 0;
  const service = createReplayService({ hooks: o.hooks ?? { listen: true, observe: true }, setTimer: () => 0, clearTimer: () => undefined, evidenceId: () => 'pe-r' + String(++ids) });
  service.start(ctx);
  return { clock, service, ctx, tabModel, docStore, events, ports, armed, excluded };
}

function sender(frameId = 0, documentId = TOP, host = SHOP): PageSenderContext {
  return { tabId: TAB, frameId, documentId, documentKey: makeDocumentKey(TAB, frameId, documentId), host, originPattern: 'https://' + host + '/*', documentLifecycle: 'active', frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame' };
}

function reg(over: Partial<RegistrationSampleSw>): RegistrationSampleSw {
  return { hookPoint: 'listen', eventCode: 'keydown', targetKind: 'document', script: SIM, sampled: true, count: 1, ageMs: 10, ...over };
}

function events(registrations: RegistrationSampleSw[], over: Partial<ProtectEventsMessage> = {}): ProtectEventsMessage {
  return { schemaVersion: 1, type: 'protect-events', sensorBootId: 'boot-a', relaySessionId: 'relay-a', batchSeq: 1, sends: [], registrations, dropped: { sends: 0, registrations: 0, unsampled: 0 }, limitations: [], ...over };
}

function observeReg(over: Partial<RegistrationSampleSw> = {}): RegistrationSampleSw {
  return { hookPoint: 'observe-document', targetKind: 'document', script: SIM, sampled: true, count: 1, ageMs: 10, ...over };
}

/** A recorder's page-level registrations (S1 + S2) by `script`. */
function recorderRegistrations(s: Setup, script: ScriptRef = SIM, sampled = true, frame = sender()): void {
  s.service.onPageMessage(frame, events([
    reg({ eventCode: 'keydown', targetKind: 'document', script, sampled }),
    reg({ eventCode: 'input', targetKind: 'document', script, sampled }),
    reg({ eventCode: 'mousemove', targetKind: 'window', script, sampled }),
    reg({ eventCode: 'scroll', targetKind: 'window', script, sampled }),
    observeReg({ script, sampled }),
  ]));
}

let seq = 0;
function sendDetails(t: number, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { requestId: 'r' + String(++seq), tabId: TAB, frameId: 0, documentId: TOP, url: 'https://rec.example.net/collect?sid=1', type: 'xmlhttprequest', timeStamp: t, initiator: 'https://' + SHOP, method: 'POST', ...over };
}

/** One send: onRequest only when the tab is armed (Chrome gives bodies only there), then onSendHeaders. */
function send(s: Setup, t: number, body: Uint8Array | null, over: Partial<RequestDetailsLike> = {}): void {
  const d = sendDetails(t, over);
  const ctx = { resolved: s.tabModel.resolveRequest(d) };
  if (s.armed.has(d.tabId)) s.service.onRequest({ ...d, ...(body !== null ? { requestBody: { raw: [{ bytes: body.buffer as ArrayBuffer }] } } : {}) }, ctx);
  s.service.onSendHeaders(d, ctx);
}

function sendSeries(s: Setup, n: number, bytes: number | null, over: Partial<RequestDetailsLike> = {}, start = T0, every = 1500): void {
  for (let i = 0; i < n; i++) send(s, start + i * every, bytes === null ? null : new Uint8Array(bytes).fill(65), over);
}

function projection(s: Setup): ProtectProjection {
  const base = { documentKey: TOP_KEY } as unknown as ProtectProjection;
  const out = s.service.contributeReport(TAB, base);
  if (out === undefined) throw new Error('no contribution');
  return out;
}

function summary(s: Setup): ReplaySummary {
  const r = projection(s).replay;
  if (r === null) throw new Error('no replay');
  return r;
}

describe('levels from page registrations and periodic sends', () => {
  it('positive stand: recorder on the site, POST 2 KiB every 1.5 s × 6 to another site → replay-like / low, 3 signals', () => {
    const s = setup();
    s.armed.add(TAB);
    recorderRegistrations(s);
    sendSeries(s, 6, 2048);
    const r = summary(s);
    expect(r).toMatchObject({ ruleId: 'session-replay-behavior', ruleVersion: '1', level: 'replay-like', interpretationConfidence: 'low', attributionConfidence: 'unknown', inputMasking: 'unconfirmed', vendors: [] });
    expect(r.signals.map((x) => x.code)).toEqual(['root-input-listeners', 'root-mutation-observe', 'periodic-third-party-send']);
    expect(r.signals[0]).toMatchObject({ techniqueId: 'DET-043', linkedSite: 'example.com', count: 4 });
    expect(r.periodicHosts).toEqual([{ registrableDomain: 'example.net', runMax: 6, sends: 6, largeInRunMax: 6, bodySize: '1k-16k' }]);
    expect(r.limitationCodes).toEqual(expect.arrayContaining(['vendor-rules-disabled', 'uncalibrated-threshold', 'masking-not-verifiable', 'websocket-not-observed', 'element-listeners-not-observed', 'mo-options-not-read']));
    expect(r.limitationCodes).not.toContain('no-script-attribution');
    expect(r.limitationCodes).not.toContain('body-size-not-observed');
  });

  it('R4: recorder script and endpoint of the same site (sampled-stack) → replay-recording / medium; one history event per level step', () => {
    const s = setup();
    recorderRegistrations(s, REC);
    sendSeries(s, 3, null);
    const r = summary(s);
    expect(r).toMatchObject({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'sampled-stack' });
    expect(r.limitationCodes).toContain('body-size-not-observed');
    s.service.flush();
    const published = s.events.filter((e) => e.kind === 'evidence');
    expect(published).toHaveLength(1);
    const ev = (published[0] as Extract<ProtectEvent, { kind: 'evidence' }>).evidence as ProtectReplayEvidence;
    expect(ev).toMatchObject({ protectKind: 'replay-pattern', ruleId: 'session-replay-behavior', receiver: 'example.net', relation: 'cross-site', interpretationConfidence: 'medium', attributionConfidence: 'sampled-stack', evidenceSource: 'derived', integrity: 'derived', frameContext: 'top' });
    expect(validateEvidence(ev), JSON.stringify(validateEvidence.errors)).toBe(true);
    expect((published[0] as Extract<ProtectEvent, { kind: 'evidence' }>).site).toBe('example.com');
    sendSeries(s, 2, null, {}, T0 + 4500);
    s.service.flush();
    expect(s.events.filter((e) => e.kind === 'evidence')).toHaveLength(1);
    // The summary went to the document's storage.session section.
    expect(s.docStore.doc(TOP_KEY)?.replay?.level).toBe('replay-recording');
  });

  it('without a stack sample: replay-like with no-script-attribution (the ceiling)', () => {
    const s = setup();
    recorderRegistrations(s, REC, false);
    sendSeries(s, 4, null);
    const r = summary(s);
    expect(r.level).toBe('replay-like');
    expect(r.limitationCodes).toContain('no-script-attribution');
    expect(r.signals.every((x) => x.linkedSite === undefined || x.code === 'periodic-third-party-send')).toBe(true);
  });

  it('element and field listeners never make S1; the level stays at signals-only', () => {
    const s = setup();
    s.service.onPageMessage(sender(), events([
      reg({ eventCode: 'keydown', targetKind: 'field' }),
      reg({ eventCode: 'input', targetKind: 'field-password' }),
      reg({ eventCode: 'mousemove', targetKind: 'other', sampled: false }),
      reg({ eventCode: 'scroll', targetKind: 'root' }),
    ]));
    sendSeries(s, 4, null);
    const r = summary(s);
    expect(r.level).toBe('signals-only');
    expect(r.signals.map((x) => x.code)).toEqual(['periodic-third-party-send']);
  });

  it('negatives for S3: small periodic bodies (armed), GET, first-party autosave and non-send types', () => {
    const s = setup();
    s.armed.add(TAB);
    recorderRegistrations(s);
    sendSeries(s, 8, 100); // heartbeat 100 B, body observed
    sendSeries(s, 8, null, { method: 'GET', url: 'https://hb.example.org/hb' });
    sendSeries(s, 8, 4096, { url: 'https://api.shop.example.com/autosave' }); // same site
    sendSeries(s, 8, 4096, { type: 'image', url: 'https://px.example.org/p.gif' });
    const r = summary(s);
    expect(r.level).toBe('signals-only');
    expect(r.periodicHosts).toEqual([]);
    expect(r.signals.map((x) => x.code)).toEqual(['root-input-listeners', 'root-mutation-observe']);
  });

  it('a canary in the request body yields only a size bucket; nothing of the body reaches summary, storage or debug', async () => {
    const s = setup();
    s.armed.add(TAB);
    recorderRegistrations(s, REC);
    const body = new TextEncoder().encode(JSON.stringify({ events: [{ value: CANARY }], pad: 'x'.repeat(1500) }));
    for (let i = 0; i < 3; i++) send(s, T0 + i * 1500, body);
    expect(replayBodyBytes({ raw: [{ bytes: body.buffer as ArrayBuffer }] })).toBe(body.byteLength);
    const r = summary(s);
    expect(r.periodicHosts[0]!.bodySize).toBe('1k-16k');
    s.service.flush();
    await s.docStore.flush();
    const outputs = JSON.stringify([r, s.docStore.doc(TOP_KEY), s.events, s.service.debug()]);
    expect(outputs).not.toContain(CANARY);
    expect(outputs).not.toContain('canary');
    expect(outputs).not.toContain(String(body.byteLength));
    expect(outputs).not.toMatch(/sid=|https?:\/\//);
  });

  it('bodies: form data, files and errors are never read (not observed); no body listener input outside armed tabs', () => {
    expect(replayBodyBytes({ formData: { a: ['secret'] } })).toBeNull();
    expect(replayBodyBytes({ raw: [{ file: 'C:/x' }] })).toBeNull();
    expect(replayBodyBytes({ error: 'Unknown error.' })).toBeNull();
    expect(replayBodyBytes(undefined)).toBeNull();
    expect(replayBodyBytes({ raw: [{ bytes: new ArrayBuffer(0) }] })).toBe(0);
    const s = setup();
    sendSeries(s, 3, 4096); // not armed: onRequest never ran, body not observed
    expect(summary(s).periodicHosts[0]!.bodySize).toBe('not-observed');
    expect(s.service.debug()['pendingBodies']).toBe(0);
  });

  it('hooks off (both groups off): S1 / S2 unavailable, listener-hook-off and mo-hook-off', () => {
    const s = setup({ hooks: { listen: false, observe: false } });
    recorderRegistrations(s, REC);
    sendSeries(s, 4, null);
    const r = summary(s);
    expect(r.level).toBe('signals-only');
    expect(r.limitationCodes).toEqual(expect.arrayContaining(['listener-hook-off', 'mo-hook-off']));
  });

  it('a sub-frame recorder is judged within its own document; conjunctions never mix frames', () => {
    const s = setup();
    const frame = sender(3, 'FRAMEDOC0000000000000000000000001', 'widget.example.org');
    recorderRegistrations(s, REC, false, frame); // S1 + S2 in the frame
    sendSeries(s, 4, null); // S3 from the top document
    expect(summary(s).level).toBe('signals-only');
    sendSeries(s, 4, null, { frameId: 3, documentId: 'FRAMEDOC0000000000000000000000001', initiator: 'https://widget.example.org' }, T0 + 60_000);
    expect(summary(s).level).toBe('replay-like');
    s.service.flush();
    const ev = (s.events.find((e) => e.kind === 'evidence') as Extract<ProtectEvent, { kind: 'evidence' }>).evidence;
    expect(ev).toMatchObject({ frameContext: 'cross-site-frame', frameSite: 'example.org' });
  });

  it('excluded tabs are ignored', () => {
    const s = setup();
    s.excluded.value = true;
    recorderRegistrations(s);
    sendSeries(s, 4, null);
    s.excluded.value = false;
    expect(summary(s).level).toBe('none');
  });
});

describe('replay table (S5)', () => {
  function loader(s: Setup): void {
    const d = sendDetails(T0, { type: 'script', method: 'GET', url: 'http://127.0.0.1:4174/replay/loader.js' });
    s.service.onSendHeaders(d, { resolved: s.tabModel.resolveRequest(d) });
  }

  it('test profile: the synthetic vendor gives R3 with S1 / S2 and R5 with its periodic endpoint', () => {
    const s = setup({ tables: SYNTHETIC });
    loader(s);
    s.service.onPageMessage(sender(), events([observeReg({ script: { kind: 'unknown' }, sampled: false })]));
    const r3 = summary(s);
    expect(r3).toMatchObject({ level: 'replay-like', interpretationConfidence: 'low' });
    expect(r3.vendors).toEqual([{ vendorId: 'test-replay', vendorConfidence: 'documented-resource', ruleIds: ['test-replay-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    expect(r3.limitationCodes).not.toContain('vendor-rules-disabled');
    sendSeries(s, 3, null, { url: 'http://collect.replay.example.org:4174/replay/collect' });
    const r5 = summary(s);
    expect(r5).toMatchObject({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'unknown' });
    expect(r5.periodicHosts.map((h) => h.registrableDomain)).toEqual(['example.org']);
  });

  it('production profile: synthetic entries are refused; production tables are empty (vendor-rules-disabled)', () => {
    const s = setup({ tables: SYNTHETIC, testProfile: false });
    loader(s);
    recorderRegistrations(s, REC, false);
    const r = summary(s);
    expect(r.vendors).toEqual([]);
    expect(r.limitationCodes).toContain('vendor-rules-disabled');
    expect(s.service.debug()['rulesEnabled']).toBe(false);
  });
});

describe('lifecycle', () => {
  it('SW restart: a summary kept in storage.session is never lowered and is marked cadence-reset', async () => {
    const first = setup();
    recorderRegistrations(first, REC);
    sendSeries(first, 3, null);
    first.service.flush();
    await first.docStore.flush();
    expect(first.docStore.doc(TOP_KEY)?.replay?.level).toBe('replay-recording');
    // A new worker: the doc-store hydrates from storage.session, lane memory is empty.
    const fake = createFakeChrome();
    const stored = first.docStore.doc(TOP_KEY)!;
    await fake.session.set({ ['protect-doc:' + TOP_KEY]: stored, 'protect-tabs': { v: 1, tabs: [], docs: [TOP_KEY] } });
    const docStore = new ProtectDocStore(fake.session, makeClock(T0), () => true, { flushMs: 1 });
    await docStore.hydrate();
    const s = setup({ docStore });
    const r = summary(s);
    expect(r.level).toBe('replay-recording');
    expect(r.limitationCodes).toContain('cadence-reset');
    expect(r.limitationCodes).not.toContain('loaded-before-enable');
    sendSeries(s, 2, null, {}, T0 + 100_000);
    expect(summary(s).level).toBe('replay-recording');
  });

  it('a document committed before the lane started: loaded-before-enable; the attribution port seeds root registrations conservatively', () => {
    const activity: ScriptActivityEntry[] = [
      { script: REC, scriptSite: 'example.net', hookPoints: ['listen', 'observe-document'], eventCodes: ['keydown', 'mousemove'], targetKinds: ['window', 'document'], count: 3, sampledCount: 3, countQuality: 'exact' },
      { script: SIM, scriptSite: 'example.com', hookPoints: ['listen'], eventCodes: ['keyup', 'scroll'], targetKinds: ['field', 'window'], count: 2, sampledCount: 2, countQuality: 'exact' },
    ];
    const s = setup({ committedBefore: true, attribution: { scriptActivity: () => activity, attributionFor: () => null, onResolved: () => () => undefined } });
    sendSeries(s, 3, null);
    const r = summary(s);
    expect(r.limitationCodes).toContain('loaded-before-enable');
    expect(r.level).toBe('replay-recording'); // REC: page-level only, its site = the receiver site
    expect(r.signals[0]).toMatchObject({ code: 'root-input-listeners', countQuality: 'lower-bound', linkedSite: 'example.net' });
    expect(s.service.debug()['seededFromPort']).toBe(1);
    // The mixed-target script (field + window) alone would never seed S1.
    const t = setup({ committedBefore: true, attribution: { scriptActivity: () => [activity[1]!] } });
    sendSeries(t, 3, null);
    expect(summary(t).signals.map((x) => x.code)).toEqual(['periodic-third-party-send']);
  });

  it('feature off: the lane memory and its storage.session sections go', () => {
    const s = setup();
    recorderRegistrations(s, REC);
    sendSeries(s, 3, null);
    s.service.flush();
    expect(s.docStore.doc(TOP_KEY)?.replay).toBeDefined();
    s.service.stop('feature-off');
    expect(s.docStore.doc(TOP_KEY)?.replay).toBeUndefined();
    expect(s.service.debug()).toMatchObject({ frames: 0, tops: 0, trackerDocuments: 0 });
    expect(s.service.contributeReport(TAB, { documentKey: TOP_KEY } as unknown as ProtectProjection)).toBeUndefined();
  });

  it('memory bounds: frames and documents are LRU-bounded', () => {
    const s = setup();
    for (let i = 0; i < 50; i++) {
      const doc = 'FRAME' + String(i).padStart(27, '0');
      s.service.onPageMessage(sender(1 + i, doc, 'w' + String(i) + '.example.org'), events([reg({ hookPoint: 'listen', eventCode: 'keydown', targetKind: 'window' })]));
    }
    const d = s.service.debug();
    expect(d['frames']).toBe(MAX_REPLAY_FRAMES);
    expect(d['trackerDocuments']).toBeLessThanOrEqual(32);
    s.service.onTabRemoved(TAB);
    expect(s.service.debug()).toMatchObject({ frames: 0, tops: 0 });
  });

  it('the history event is not published without a receiver (R3 only) and never below replay-like', () => {
    const s = setup({ tables: SYNTHETIC });
    const d = sendDetails(T0, { type: 'script', method: 'GET', url: 'http://127.0.0.1:4174/replay/loader.js' });
    s.service.onSendHeaders(d, { resolved: s.tabModel.resolveRequest(d) });
    recorderRegistrations(s, REC, false);
    s.service.flush();
    expect(summary(s).level).toBe('replay-like');
    expect(s.events).toEqual([]);
  });
});

describe('controller integration', () => {
  async function controllerSetup(features: string[]) {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features });
    const clock = makeClock(T0);
    const service = createReplayService({ hooks: { listen: true, observe: true } });
    const controller = new ProtectController(fake, { clock, dbFactory: () => new MemoryProtectDb(), services: [service], docStore: { flushMs: 1 }, testProfile: true });
    await controller.load();
    controller.onCommitted(committed({ tabId: TAB, documentId: TOP, url: 'https://' + SHOP + '/', timeStamp: T0 }));
    return { fake, clock, controller, service };
  }

  it('ui-protect-get-report carries a schema-valid ReplaySummary; the shared onSendHeaders listener feeds the cadence', async () => {
    const c = await controllerSetup(['session-replay']);
    expect(c.controller.listeners().sendHeaders).toBe(true);
    await c.controller.onPageMessage(sender(), events([reg({ script: REC }), reg({ eventCode: 'pointermove', targetKind: 'window', script: REC })]));
    for (let i = 0; i < 4; i++) {
      c.clock.t = T0 + i * 2000;
      c.fake.webRequestEvents.sendHeaders.emit(sendDetails(c.clock.t));
    }
    const response = await c.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-get-report', tabId: TAB }, popupSender());
    expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
    const replay = (response as unknown as { report: ProtectProjection }).report.replay!;
    expect(replay.level).toBe('signals-only');
    expect(replay.periodicHosts).toEqual([{ registrableDomain: 'example.net', runMax: 4, sends: 4, largeInRunMax: 0, bodySize: 'not-observed' }]);
  });

  it('feature off: no replay in the projection', async () => {
    const c = await controllerSetup(['value-match']);
    const response = await c.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-get-report', tabId: TAB }, popupSender());
    expect((response as unknown as { report: ProtectProjection }).report.replay).toBeNull();
  });
});
