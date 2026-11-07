// ADR-020 §12, §15 item 1 (S05, E21-05 case 2): no layer of the module «Защита» ever reads a password. The test
// profile registers a tripwire FIRST in both worlds (protect-tripwire.{isolated,main}.js): it wraps every page-input
// reader and counts reads whose target is a password field now or at any time before. Positive controls prove the
// tripwire sees what it must: the self-check (a detached password input) in both worlds, the module's own reads of
// e-mail / phone / name in ISOLATED (nonPasswordReads ≥ 1), and the page's #positive-control (exactly one MAIN hit).
// Then: password typing, «show password» (type -> text) and more typing, a one-time code, an e-mail next to a
// cc-number in a cross-site payment frame -> hits = 0 in both worlds of both documents. The password canary (and every
// module canary, with hash/encoding variants) is absent from storage.local, storage.session, the IndexedDB dump, the
// SW state and projection, the intercepted protect-* messages and the module channel.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { getServiceWorker, repoRoot, startFixtureServer } from '../harness';
import { brief, dumpLocal, dumpSession, fixtureResult } from '../helpers';
import {
  PROTECT_SCRIPT_IDS,
  canaryHits,
  captureModuleChannel,
  dumpProtectDb,
  enableProtect,
  grantAllSites,
  harness,
  isolatedWire,
  launchProtect,
  moduleChannel,
  protectRoute,
  registeredScripts,
  standUrl,
  tripwire,
  typeInto,
} from './support';
import type { Canary } from './support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const canary = (id: string): string => {
  const c = registry.protect.find((x) => x.id === id);
  if (c === undefined) throw new Error('canaries.json: ' + id + ' missing');
  return c.value;
};
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));

test('password is never read by any layer: tripwire in both worlds with positive controls', async () => {
  test.setTimeout(120_000);
  const ext = await launchProtect();
  const server = await startFixtureServer();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const enabled = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(enabled.state?.state, brief(enabled)).toBe('active');
    const scripts = await registeredScripts(sw, [...PROTECT_SCRIPT_IDS]);
    // The tripwire runs first in each world (test profile only).
    expect(scripts.find((s) => s.id === 'detector-protect-isolated-v1')?.js).toEqual(['protect-tripwire.isolated.js', 'protect.js']);
    expect(scripts.find((s) => s.id === 'detector-protect-main-v1')?.js[0]).toBe('protect-tripwire.main.js');

    const page = await ext.context.newPage();
    await captureModuleChannel(page);
    const origin = server.origins[0]!;
    await page.goto(standUrl(origin, 'www.example.com', '/protect/password-tripwire.html?frameHost=pay.example.net'));
    await fixtureResult(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fixtureResult: { frameLoaded: boolean } }).__fixtureResult.frameLoaded)).toBe(true);
    const frame = page.frames().find((f) => f.url().includes('frame=payment'));
    if (frame === undefined) throw new Error('payment frame not found: ' + brief(page.frames().map((f) => f.url())));
    expect(new URL(frame.url()).hostname).toBe('pay.example.net');

    // 1. Self-check in both worlds of both documents (the tripwire is installed and recognizes a password).
    for (const target of [page, frame]) {
      await expect.poll(() => tripwire(target), { message: 'tripwire self-check in ' + target.url() }).toEqual({
        isolated: { hits: 0, selfCheck: 1, nonPasswordReads: 0 },
        main: { hits: 0, selfCheck: 1, nonPasswordReads: 0 },
      });
    }
    const wire = await isolatedWire(page, sw);

    // 2. Positive control of the ISOLATED reader: e-mail, phone and name are read by the module (nonPasswordReads).
    await typeInto(page, page.locator('#email'), canary('protect-email'));
    await typeInto(page, page.locator('#phone'), canary('protect-phone'));
    await typeInto(page, page.locator('#name'), canary('protect-name'));
    await page.locator('#title').click();
    await expect.poll(async () => (await tripwire(page)).isolated?.nonPasswordReads ?? 0, { message: 'the module read the e-mail / phone / name fields' }).toBeGreaterThanOrEqual(1);

    // 3. Password, «show password» and more typing, a one-time code, a textarea, an e-mail next to a cc-number.
    await typeInto(page, page.locator('#password'), canary('protect-password'));
    await page.locator('#show-password').click();
    await expect.poll(() => page.locator('#password').getAttribute('type')).toBe('text');
    await typeInto(page, page.locator('#password'), '-' + canary('protect-password'));
    await page.locator('#show-password').click();
    await typeInto(page, page.locator('#otp'), '482913');
    await typeInto(page, page.locator('#notes'), 'free text ' + canary('protect-password'));
    const pay = page.frameLocator('#pay-frame');
    await typeInto(page, pay.locator('#pay-email'), canary('protect-email'));
    await pay.locator('#cc-number').click();
    await page.locator('#title').click();
    await page.waitForTimeout(PROTECT_BUDGETS.inputDebounceMs + 700);

    // 4. hits = 0 in both worlds of both documents; the payment frame suspended every read (nothing read there).
    const top = await tripwire(page);
    const sub = await tripwire(frame);
    expect(top.isolated?.hits, 'ISOLATED hits (top): ' + brief(top)).toBe(0);
    expect(top.main?.hits, 'MAIN hits (top): ' + brief(top)).toBe(0);
    expect(sub, 'payment frame: no hit, and no read at all (payment suspends reading)').toEqual({
      isolated: { hits: 0, selfCheck: 1, nonPasswordReads: 0 },
      main: { hits: 0, selfCheck: 1, nonPasswordReads: 0 },
    });
    expect(top.isolated?.nonPasswordReads).toBeGreaterThanOrEqual(1);

    // 5. Positive control of the MAIN tripwire: the page reads the password once.
    await page.locator('#positive-control').click();
    await expect.poll(async () => (await tripwire(page)).main?.hits).toBe(1);
    expect((await fixtureResult<{ positiveControlReads: number }>(page)).positiveControlReads).toBe(1);
    expect((await tripwire(page)).isolated?.hits).toBe(0);

    // 6. No canary (nor a hash / encoding variant) in storage, IndexedDB, SW state, projection, wire or channel.
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? -1, page.url());
    const dumps: Record<string, unknown> = {
      local: await dumpLocal(sw),
      session: await dumpSession(sw),
      idb: await dumpProtectDb(sw),
      state: await harness(sw, 'state'),
      report: await protectRoute(sw, { type: 'ui-protect-get-report', tabId }),
      wire: await wire.read(),
      channel: [...(await moduleChannel(page)), ...(await moduleChannel(frame))],
    };
    const sent = dumps['wire'] as string[];
    expect(sent.some((m) => m.includes('"protect-arm"')), 'the module was active in the page: ' + brief(sent)).toBe(true);
    for (const [name, dump] of Object.entries(dumps)) {
      expect(canaryHits(JSON.stringify(dump), FIELD_CANARIES), name + ': ' + brief(dump, 600)).toEqual([]);
    }
    test.info().annotations.push({
      type: 'tripwire',
      description: 'top=' + JSON.stringify(await tripwire(page)) + ' frame=' + JSON.stringify(await tripwire(frame)) + ' protect-* messages=' + String(sent.length),
    });
  } finally {
    await server.close();
    await ext.close();
  }
});
