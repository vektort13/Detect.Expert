// Shared stand of the firewall e2e specs (ADR-020 §C, §11; S08). SP-1 / FOLLOWUPS 76: after the optional
// declarativeNetRequestWithHostAccess grant, rule writes do not complete until the extension is loaded again with the
// grant, so the stand enables the module through the real Options consent screen (permissions by click), then
// restarts the browser with the same profile — as the S01 spike did. Ground truth is the fixture server's counter of
// delivered requests (tests/fixture-routes/firewall.mjs); the extension's own numbers are lower bounds.
// Prompts: value-match (S07) produces them from real typing; the stand additionally injects the same evidence
// through the test-profile harness (`inject('firewall', {op:'evidence'})`) and arms the tab (`{op:'arm'}`) so the
// firewall lane is exercised independently of the value-match lane. Both are idempotent with the real path.

import { chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProtectProjection } from '@detect-expert/contracts';
import { distTest, getServiceWorker, startFixtureServer, type ExtensionSession, type FixtureServer } from '../harness';
import { brief, enableProtectViaOptions, fixtureResult, tabIdOf } from '../helpers';
import { PROTECT_RESOLVER, grantAllSites, ourDnrRules, protectRoute, protectState, standUrl, typeInto } from './support';
import type { ProtectStateResponse } from './support';

export const RECEIVER_KEY_HOST = 'collect.example.net';
export const FW_PATH = '/fw/collect';
export const SLACK_WAIT_MS = 150;

export interface FirewallStand {
  server: FixtureServer;
  context: BrowserContext;
  sw: Worker;
  userDataDir: string;
  /** Closes the browser and launches it again with the same profile (the extension loads with its grants). */
  restart(): Promise<void>;
  /** After the service worker was stopped: waits for the restarted worker (woken by an event) and the active module. */
  refreshWorker(): Promise<void>;
  close(): Promise<void>;
}

async function launchContext(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + distTest, '--load-extension=' + distTest, '--host-resolver-rules=' + PROTECT_RESOLVER, '--no-proxy-server'],
  });
}

/**
 * All-sites grant, the module enabled in Options with `features` and `preset` (DNR granted by the click), then a
 * browser restart so DNR writes work (SP-1). The module is active after the restart.
 */
export async function launchFirewallStand(features: string[] = ['value-match', 'firewall'], preset = 'normal'): Promise<FirewallStand> {
  const server = await startFixtureServer();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-fw-'));
  let context = await launchContext(userDataDir);
  let sw = await getServiceWorker(context);
  const session = (): ExtensionSession => ({ context, userDataDir, dist: distTest, extension: true, close: async () => undefined });
  await grantAllSites(session(), sw);
  const on = (await enableProtectViaOptions(context, sw, features, preset)) as ProtectStateResponse;
  // SP-1: with a rule to write at once (strict preset table), the write hangs until the restart below → `degraded`
  // with blocking-unavailable (api-unavailable), never a claimed rule.
  expect(['active', 'degraded'], brief(on)).toContain(on.state?.state);
  if (on.state?.state === 'degraded') expect(on.state.degradedReasons).toEqual(['blocking-unavailable']);
  expect(on.state?.permissions.dnr).toBe(true);
  const stand: FirewallStand = {
    server,
    get context() {
      return context;
    },
    get sw() {
      return sw;
    },
    userDataDir,
    async restart() {
      await context.close();
      context = await launchContext(userDataDir);
      sw = await getServiceWorker(context);
      await expect.poll(async () => (await protectState(sw)).state, { timeout: 20_000, message: 'module active after the browser restart' }).toBe('active');
      await expect.poll(async () => (await ourDnrRules(sw)).api).toBe(true);
    },
    async refreshWorker() {
      await expect.poll(async () => {
        for (const w of [...context.serviceWorkers()].reverse()) {
          try {
            await w.evaluate(() => 1);
            sw = w;
            return true;
          } catch {
            // a stopped worker's handle
          }
        }
        return false;
      }, { timeout: 20_000, message: 'restarted service worker' }).toBe(true);
      await expect.poll(async () => (await protectState(sw)).state, { timeout: 20_000 }).toBe('active');
    },
    async close() {
      await context.close().catch(() => undefined);
      await server.close();
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  await stand.restart();
  return stand;
}

/** Delivered requests to `host` (port 4174) on the receiver path, per the fixture server. */
export function delivered(stand: FirewallStand, host = RECEIVER_KEY_HOST): number {
  const port = new URL(stand.server.origins[1]!).port;
  return stand.server.stats.routes['firewall']?.[host + ':' + port + FW_PATH] ?? 0;
}

export interface StandPage {
  page: Page;
  tabId: number;
}

/** Opens a stand page (`host`, origin 0 = :4173) and waits for the sender (or the frame) to be ready. */
export async function openStandPage(stand: FirewallStand, host: string, file: string, query = ''): Promise<StandPage> {
  const page = await stand.context.newPage();
  const url = standUrl(stand.server.origins[0]!, host, '/protect/firewall/' + file) + query;
  await page.goto(url);
  await fixtureResult(page);
  const tabId = await tabIdOf(stand.sw, page.url());
  return { page, tabId };
}

/** `__protectHarness.inject('firewall', payload)` (test profile only; the lane validates the payload). */
export async function inject(stand: FirewallStand, payload: Record<string, unknown>): Promise<unknown> {
  return stand.sw.evaluate(async (p) => {
    const h = (globalThis as unknown as { __protectHarness: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    return h.inject('firewall', p);
  }, payload);
}

export async function report(stand: FirewallStand, tabId: number): Promise<ProtectProjection> {
  const r = await protectRoute(stand.sw, { type: 'ui-protect-get-report', tabId });
  const projection = (r as { report?: ProtectProjection | null }).report;
  if (projection === null || projection === undefined) throw new Error('no protect report for tab ' + String(tabId) + ': ' + brief(r));
  return projection;
}

/** The user types an e-mail (trusted input) and leaves the field: the sender's first request goes (never stopped). */
export async function typeEmail(stand: FirewallStand, sp: StandPage, value = 'fw-user@example.com'): Promise<void> {
  await typeInto(sp.page, sp.page.locator('#email'), value);
  await inject(stand, { op: 'arm', tabId: sp.tabId });
  await sp.page.locator('#title').click(); // blur: the sender's first request
  await sp.page.waitForTimeout(400);
}

/** Evidence of a transfer to `receiver` before submit (the value-match lane's output, injected for independence). */
export async function promptFor(stand: FirewallStand, sp: StandPage, receiver = 'example.net'): Promise<ProtectProjection> {
  await inject(stand, { op: 'evidence', tabId: sp.tabId, receiver });
  let last: ProtectProjection | null = null;
  await expect.poll(async () => {
    last = await report(stand, sp.tabId);
    return last.firewall.prompt?.receivers.includes(receiver) === true || last.firewall.receivers.some((r) => r.receiver === receiver && r.effectiveRule !== null);
  }, { message: 'prompt for ' + receiver }).toBe(true);
  return last!;
}

export interface DecideResult {
  type: string;
  code?: string;
  applied?: Array<{ receiver: string; ruleApplied: boolean }>;
  undoId?: string | null;
}

export async function decide(stand: FirewallStand, sp: StandPage, receivers: string[], action: 'block' | 'allow', scope: 'once' | 'site' | 'everywhere'): Promise<DecideResult> {
  const r = await report(stand, sp.tabId);
  const prompt = r.firewall.prompt;
  if (prompt === null) throw new Error('no prompt in tab ' + String(sp.tabId) + ': ' + brief(r.firewall));
  const res = (await protectRoute(stand.sw, { type: 'ui-protect-decide', tabId: sp.tabId, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: prompt.promptId, receivers, action, scope })) as unknown as DecideResult;
  // §11: a request counts as stopped only if our rule was active ≥ 50 ms before it.
  await sp.page.waitForTimeout(SLACK_WAIT_MS);
  return res;
}

/** `n` rounds of the sender's four request kinds (beacon, fetch, image, XHR); resolves after they settled. */
export async function sendAttempts(sp: StandPage, rounds = 1): Promise<number> {
  for (let i = 0; i < rounds; i++) await sp.page.evaluate(() => (window as unknown as { __fwSend(kind?: string): unknown }).__fwSend());
  await sp.page.waitForTimeout(600);
  return rounds * 4;
}

/** Frame of iframe-host.html (the cross-site form). */
export async function frameSend(sp: StandPage): Promise<void> {
  const frame = sp.page.frames().find((f) => f !== sp.page.mainFrame());
  if (frame === undefined) throw new Error('no frame');
  await frame.waitForFunction(() => typeof (window as unknown as { __fwSend?: unknown }).__fwSend === 'function');
  await frame.evaluate(() => (window as unknown as { __fwSend(kind?: string): unknown }).__fwSend());
  await sp.page.waitForTimeout(600);
}

export async function serviceDebug(stand: FirewallStand): Promise<Record<string, number | boolean>> {
  return stand.sw.evaluate(() => (globalThis as unknown as { __protectHarness: { service(n: string): { debug(): Record<string, number | boolean> } } }).__protectHarness.service('firewall').debug());
}
