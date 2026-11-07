// ADR-020 §F (S10, E21-10 case 3): "who sent the request" in a real Chromium. The test profile runs the candidate hook
// configuration (packages/sensors/src/protect/config.ts; the release profile stays off until the perf gate). Stand:
// fixtures/protect/attribution/send.html on shop.example.com; scripts from cdn.tracker-a / cdn.tracker-b.example.org
// (host-resolver -> loopback); every case sends to its own receiver host. Expected: external ScriptRef (host + path
// template, no port / query) at sampled-stack and `unique` for tracker-a's fetch / XHR / sendBeacon; `document` for
// inline code and a relative address; `eval`; `opaque` for a blob: script; `ambiguous` for the two scripts sending at
// the same moment. The receivers got exactly the requests the page made: the extension sends nothing of its own.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ScriptAttribution } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { captureModuleChannel, dumpProtectDb, enableProtect, grantAllSites, launchProtect, moduleChannel, protectRoute, standUrl } from './support';

interface Decided {
  cls: string;
  host: string | null;
  frame: number;
  attribution: ScriptAttribution;
}

async function decided(sw: Worker, tabId: number): Promise<Decided[]> {
  return sw.evaluate(async (id) => {
    const h = (globalThis as unknown as { __protectHarness: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    return (await h.inject('attribution', { op: 'results', tabId: id })) as Decided[];
  }, tabId) as Promise<Decided[]>;
}

test('attribution of sends: external, document, eval, opaque, ambiguous; exact request counts at the receivers', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');

    const page = await ext.context.newPage();
    const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/attribution/send.html');
    await page.goto(url);
    const result = await fixtureResult<{ sent?: string[]; error?: string }>(page, 20_000);
    expect(result.error, brief(result)).toBeUndefined();
    const tabId = await tabIdOf(sw, url);

    const expectedHosts = ['collect-ext.example.net', 'collect-xhr.example.net', 'collect-beacon.example.net', 'collect-inline.example.net', 'shop.example.com', 'collect-eval.example.net', 'collect-blob.example.net'];
    await expect
      .poll(async () => {
        const d = await decided(sw, tabId);
        return expectedHosts.every((h) => d.some((x) => x.host === h)) && d.filter((x) => x.host === 'collect-amb.example.net').length === 2;
      }, { timeout: 20_000, message: 'every request of the stand is decided' })
      .toBe(true);
    const d = await decided(sw, tabId);
    const by = (host: string): Decided[] => d.filter((x) => x.host === host);
    const tracker = { kind: 'external', scheme: 'http', host: 'cdn.tracker-a.example.org', pathTemplate: '/protect/attribution/tracker-a.js' };

    for (const [host, cls] of [['collect-ext.example.net', 'xmlhttprequest'], ['collect-xhr.example.net', 'xmlhttprequest'], ['collect-beacon.example.net', 'ping']] as const) {
      expect(by(host), host).toHaveLength(1);
      expect(by(host)[0], brief(d)).toMatchObject({
        cls,
        frame: 0,
        attribution: {
          script: tracker,
          scriptSite: 'example.org',
          scriptRelation: 'cross-site',
          attributionConfidence: 'sampled-stack',
          evidenceSource: 'page-hook',
          integrity: 'page-controlled',
          correlation: 'unique',
          scriptLoadObserved: true,
          limitationCodes: ['nearest-frame-only'],
        },
      });
    }
    expect(by('collect-inline.example.net')[0]?.attribution, brief(d)).toMatchObject({ script: { kind: 'document' }, scriptRelation: 'same-origin', attributionConfidence: 'sampled-stack', correlation: 'unique' });
    expect(by('shop.example.com')[0]?.attribution, brief(d)).toMatchObject({ script: { kind: 'document' }, correlation: 'unique' });
    expect(by('collect-eval.example.net')[0]?.attribution, brief(d)).toMatchObject({ script: { kind: 'eval' }, attributionConfidence: 'sampled-stack', correlation: 'unique' });
    expect(by('collect-blob.example.net')[0]?.attribution, brief(d)).toMatchObject({ script: { kind: 'opaque' }, correlation: 'unique' });
    for (const x of by('collect-amb.example.net')) {
      expect(x.attribution, brief(d)).toMatchObject({ script: null, attributionConfidence: 'unknown', correlation: 'ambiguous', limitationCodes: ['correlation-ambiguous'] });
    }
    // No port, query, fragment, line:column or function name in what the SW holds.
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/:417[34]|\?|#|:\d+:\d+|sendFetch|trackerA/);

    // The receivers got exactly the page's requests: the extension sent nothing of its own.
    const counts = server.stats.routes['attribution'] ?? {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total, JSON.stringify(counts)).toBe(result.sent!.length);
    for (const key of result.sent!) expect(counts[key], key).toBe(1);
  } finally {
    await ext.close();
    await server.close();
  }
});

// REQ-005 (S10): fixtures/privacy/protect-attribution-canary.html carries canaries in the page URL (query, fragment),
// an external script URL (query, fragment), the receiver URL (path id, query, fragment) and function names on the stack.
// None of them appears on the module channel, in the SW's attributions, the module projection, storage.session,
// storage.local or the module's IndexedDB.
test('attribution canaries: nothing of a URL, stack or function name leaves the page or reaches storage', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    const page = await ext.context.newPage();
    await captureModuleChannel(page);
    const url = standUrl(server.origins[0]!, 'shop.example.com', '/privacy/protect-attribution-canary.html?CANARY-QUERY-7a1c9e3f#CANARY-FRAGMENT-2d5f8b1a');
    await page.goto(url);
    await fixtureResult(page, 20_000);
    const tabId = await tabIdOf(sw, url.split('#')[0]!);
    await expect.poll(async () => (await decided(sw, tabId)).filter((d) => d.host === 'collect-canary.example.net' || d.host === 'collect-ext.example.net').length, { timeout: 20_000 }).toBe(3);
    const channel = await moduleChannel(page);
    expect(channel.length).toBeGreaterThan(0);
    const report = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
    const stores = {
      channel,
      decided: await decided(sw, tabId),
      report,
      session: await sw.evaluate(() => chrome.storage.session.get(null)),
      local: await sw.evaluate(() => chrome.storage.local.get(null)),
      idb: await dumpProtectDb(sw),
    };
    const text = JSON.stringify(stores);
    for (const canary of ['CANARY-QUERY-7a1c9e3f', 'CANARY-FRAGMENT-2d5f8b1a', 'CANARY-PATH-ID-5566', 'canaryStackFrame_8e1d', 'sendFetch']) {
      expect(text.includes(canary), canary).toBe(false);
    }
    // What the module produced (channel, attributions, projection): no frame position, extension URL or port either.
    const moduleText = JSON.stringify({ channel: stores.channel, decided: stores.decided, report: stores.report });
    expect(moduleText).not.toMatch(/\.(?:js|html):\d+:\d+|:\d+:\d+\)|chrome-extension:|:417[34]/); // (document keys are tab:frame:id)
  } finally {
    await ext.close();
    await server.close();
  }
});
