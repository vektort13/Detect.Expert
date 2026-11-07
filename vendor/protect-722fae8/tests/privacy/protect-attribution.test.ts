// ADR-020 §F, REQ-005 (S10): the attribution path end to end in Node — MAIN hooks on a fake realm (real V8 stacks of
// scripts named with canary-laden URLs) -> protect-main-* on the module channel -> the ISOLATED relay (collector) ->
// protect-events -> the SW attribution service -> ScriptAttribution, script activity and password-field-listener
// evidence. No canary of a query, fragment, userinfo, path id, function name, line:column or chrome-extension: URL
// appears in any of these wire shapes or results.

import { describe, expect, it } from 'vitest';
import { makeDocumentKey, validateProtectMainMessage, validateProtectPageMessage } from '@detect-expert/contracts';
import type { ProtectEventsMessage } from '@detect-expert/contracts';
import { installProtectMain } from '../../packages/sensors/src/protect/index';
import { PROTECT_HOOK_CANDIDATE } from '../../packages/sensors/src/protect/config';
import { makeEnv } from '../../packages/sensors/test/helpers';
import { makeRealm, withoutPrepareStackTrace } from '../../packages/sensors/test/protect-fakes';
import { ProtectRelay } from '../../packages/collector/src/protect/relay';
import { FakeProtectEnv } from '../../packages/collector/test/protect-fakes';
import { createAttributionService } from '../../packages/background/src/protect/attribution/index';
import type { AttributionPort } from '../../packages/background/src/protect/attribution/index';
import { ProtectDocStore } from '../../packages/background/src/protect/doc-store';
import { ProtectEventBus } from '../../packages/background/src/protect/event-bus';
import { EMPTY_PROTECT_TABLES } from '../../packages/background/src/protect/services';
import type { ProtectServiceContext } from '../../packages/background/src/protect/services';
import { ProtectTabModel } from '../../packages/background/src/protect/tab-model';
import { createFakeChrome } from '../../packages/background/test/fake-chrome';

const CANARIES = {
  query: 'CANARY-QUERY-7a1c9e3f',
  fragment: 'CANARY-FRAGMENT-2d5f8b1a',
  pathId: 'CANARY-PATH-ID-5566',
  userinfo: 'canaryuser',
  password: 'canarypass',
  functionName: 'canaryStackFrame_8e1d',
};
const SCRIPT_URL = 'https://' + CANARIES.userinfo + ':' + CANARIES.password + '@cdn.tracker-a.example.org:8443/lib/' + CANARIES.pathId + '/collect.js?' + CANARIES.query + '#' + CANARIES.fragment;
const TARGET_URL = 'https://' + CANARIES.userinfo + '@collect.example.net:9443/v1/' + CANARIES.pathId + '?q=' + CANARIES.query + '#' + CANARIES.fragment;
const OTHER_EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/content.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertClean(label: string, text: string): void {
  for (const [name, canary] of Object.entries(CANARIES)) expect(text, label + ': ' + name).not.toContain(canary);
  expect(text, label + ': 5566').not.toContain('5566');
  expect(text, label + ': line:column').not.toMatch(/:\d+:\d+/);
  expect(text, label + ': chrome-extension:').not.toContain('chrome-extension:');
  expect(text, label + ': port').not.toMatch(/:8443|:9443/);
}

describe('protect attribution wire (REQ-005)', () => {
  it('no canary reaches the module channel, protect-events, attributions, activity or evidence', async () => {
    // MAIN
    const fr = makeRealm();
    const main = makeEnv();
    main.advance(9000); // MAIN page clock next to the relay's monotonic clock (shared timeOrigin, SP-12)
    const handle = installProtectMain(fr.realm, { groups: 3, earlyCapture: true }, { env: main.env, docHost: 'shop.example.com', config: PROTECT_HOOK_CANDIDATE });
    expect(handle).not.toBeNull();
    // ISOLATED relay, wired to the MAIN fake window both ways.
    const iso = new FakeProtectEnv();
    const relay = new ProtectRelay(iso, (m) => main.dispatch('message', { source: main.self, data: JSON.parse(JSON.stringify(m)) }));
    const mainPosted: unknown[] = [];
    const pump = (): void => {
      while (main.posted.length > 0) {
        const m = main.posted.shift();
        mainPosted.push(m);
        iso.postWindow(m);
      }
    };
    relay.start();
    pump();
    await wait(5);
    pump();

    withoutPrepareStackTrace(() => {
      fr.runAs(SCRIPT_URL, [
        'function ' + CANARIES.functionName + '() {',
        '  realm.fetch(' + JSON.stringify(TARGET_URL) + ');',
        '  realm.navigator.sendBeacon(' + JSON.stringify(TARGET_URL) + ', "data-' + CANARIES.query + '");',
        '  const pw = password; pw.addEventListener("input", function ' + CANARIES.functionName + '_listener() {});',
        '  realm.document.addEventListener("keydown", () => 0);',
        '}',
        CANARIES.functionName + '();',
      ].join('\n'), { realm: fr.realm, password: fr.newInput('password') });
      // Only the other extension's frame on the stack (as for its content script in a browser): stackTraceLimit 1.
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 1;
      try {
        fr.runAs(OTHER_EXTENSION, 'realm.fetch("/api/" + q);', { realm: fr.realm, q: CANARIES.query });
      } finally {
        Error.stackTraceLimit = limit;
      }
    });
    main.advance(300);
    pump();
    iso.mono = 10_400;
    await wait(20);
    pump();

    const events = iso.messages('protect-events') as ProtectEventsMessage[];
    expect(events.length).toBeGreaterThan(0);
    for (const m of mainPosted) expect(validateProtectMainMessage(m).ok).toBe(true);
    for (const m of events) expect(validateProtectPageMessage(m).ok).toBe(true);
    const sends = events.flatMap((e) => e.sends);
    expect(sends.map((s) => [s.hookPoint, s.script.kind, s.target])).toEqual([
      ['send-fetch', 'external', { kind: 'absolute', host: 'collect.example.net' }],
      ['send-beacon', 'external', { kind: 'absolute', host: 'collect.example.net' }],
      ['send-fetch', 'extension', { kind: 'relative' }],
    ]);
    expect(sends[0]!.script).toEqual({ kind: 'external', scheme: 'https', host: 'cdn.tracker-a.example.org', pathTemplate: '/lib/CANARY-PATH-ID-:id/collect.js' });

    // SW
    const fake = createFakeChrome();
    const clock = { now: () => 1_700_000_000_000 };
    const tabModel = new ProtectTabModel(clock);
    tabModel.noteCommitted({ tabId: 3, frameId: 0, documentId: 'TOP', url: 'https://shop.example.com/', timeStamp: clock.now() });
    const docStore = new ProtectDocStore(fake.session, clock, () => true, { flushMs: 1 });
    const ports = { firewallEvaluate: () => null, attribution: null as unknown, pendingCount: () => 0 };
    const ctx = { db: null, docStore, tabModel, eventBus: new ProtectEventBus(), clock, tables: EMPTY_PROTECT_TABLES, ports, testProfile: false, settings: () => ({}), isExcluded: () => false, isTabExcluded: () => false, sendControl: () => undefined } as unknown as ProtectServiceContext;
    const service = createAttributionService({ setTimer: () => 0, clearTimer: () => undefined });
    service.start(ctx);
    const sender = { tabId: 3, frameId: 0, documentId: 'TOP', documentKey: makeDocumentKey(3, 0, 'TOP'), host: 'shop.example.com', originPattern: 'https://shop.example.com/*', documentLifecycle: 'active' as const, frameType: 'outermost_frame' as const };
    service.onSendHeaders({ requestId: 'R1', tabId: 3, frameId: 0, documentId: 'TOP', type: 'xmlhttprequest', url: TARGET_URL, initiator: 'https://shop.example.com', timeStamp: clock.now() }, { resolved: null });
    for (const e of events) service.onPageMessage(sender, e);
    (clock as { now: () => number }).now = () => 1_700_000_000_000 + 1000;
    service.tick();
    const port = ports.attribution as AttributionPort;
    const attribution = port.attributionFor('R1');
    expect(attribution).not.toBeNull();
    const evidence = docStore.doc(makeDocumentKey(3, 0, 'TOP'))?.evidence ?? [];
    expect(evidence.map((e) => e.protectKind)).toEqual(['password-field-listener']);

    assertClean('module channel', JSON.stringify(mainPosted));
    assertClean('protect-events', JSON.stringify(events));
    assertClean('attribution', JSON.stringify(attribution));
    assertClean('activity', JSON.stringify(port.scriptActivity(sender.documentKey)));
    assertClean('evidence', JSON.stringify(evidence));
    assertClean('debug', JSON.stringify(service.debugInject({ op: 'results' })));
    relay.stop('revoked');
    handle!.stop();
  });
});
