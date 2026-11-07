// Playwright harness for the extension: persistent context with the test-profile build loaded, service worker
// access and two loopback fixture servers (distinct origins) served by tests/fixture-server.mjs.
// Spec V §9 / ADR-002: chromium.launchPersistentContext, channel 'chromium', one temporary profile per session.

import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_PORTS as SERVER_PORTS, startFixtureServer as startServer, type FixtureServer } from '../fixture-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const distTest = path.join(repoRoot, 'dist', 'test');
export const fixturesDir = path.join(repoRoot, 'fixtures');
export const FIXTURE_PORTS: readonly number[] = SERVER_PORTS;
export type { FixtureServer, FixtureServerStats } from '../fixture-server.mjs';

export interface ExtensionSession {
  context: BrowserContext;
  userDataDir: string;
  /** dist/test when the extension is loaded; '' for a plain (differential baseline) context. */
  dist: string;
  extension: boolean;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Test setup diagnostics; never serialized into the extension or page. */
  diagnostic?: (stage: string) => void;
  /** P08: deterministic presentation without overriding Chrome's extension locale after launch. */
  locale?: string;
  timezoneId?: string;
  profile?: 'test' | 'test-optional';
  /** P05: allow CDP to invoke the actual toolbar action (Chrome grants activeTab). */
  extensionActionDebugging?: boolean;
  headless?: boolean;
  /** P01: resolve fixture-only names to loopback without DNS traffic. */
  hostResolverRules?: string;
  /** false = plain Chromium without the extension (differential baseline). Default true. */
  extension?: boolean;
  /** Drop Playwright's default --disable-back-forward-cache so BFCache scenarios can be exercised. */
  backForwardCache?: boolean;
}

export async function launch(options: LaunchOptions = {}): Promise<ExtensionSession> {
  const withExtension = options.extension ?? true;
  const dist = path.join(repoRoot, 'dist', options.profile ?? 'test');
  if (withExtension && !existsSync(path.join(dist, 'manifest.json'))) {
    throw new Error(dist + '/manifest.json not found; build the requested profile first');
  }
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-pw-'));
  options.diagnostic?.('launchPersistentContext starting');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: options.headless ?? true,
    timeout: 20_000,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.timezoneId === undefined ? {} : { timezoneId: options.timezoneId }),
    args: [...(withExtension ? ['--disable-extensions-except=' + dist, '--load-extension=' + dist] : []), ...(options.extensionActionDebugging ? ['--enable-unsafe-extension-debugging'] : []), ...(options.hostResolverRules ? ['--host-resolver-rules=' + options.hostResolverRules, '--no-proxy-server'] : [])],
    ...(options.backForwardCache === true ? { ignoreDefaultArgs: ['--disable-back-forward-cache'] } : {}),
  });
  options.diagnostic?.('launchPersistentContext ready');
  return {
    context,
    userDataDir,
    dist: withExtension ? dist : '',
    extension: withExtension,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/** Same Chromium, no extension: the baseline of differential runs (ADR-006 acceptance). */
export async function launchPlain(options: Omit<LaunchOptions, 'extension'> = {}): Promise<ExtensionSession> {
  return launch({ ...options, extension: false });
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker');
}

export function extensionIdOf(worker: Worker): string {
  return new URL(worker.url()).host;
}

export async function startFixtureServer(ports: readonly number[] = FIXTURE_PORTS): Promise<FixtureServer> {
  return startServer(ports);
}

export const test = base.extend<{ ext: ExtensionSession; fixtures: FixtureServer }>({
  ext: async ({}, use, testInfo) => {
    const diagnostic = testInfo.title.includes('544 dirty aggregates') ? (stage: string) => console.log('P07 ring setup: ' + stage) : undefined;
    const session = await launch(diagnostic ? { diagnostic } : {});
    try { await use(session); } finally { diagnostic?.('context closing'); await session.close(); diagnostic?.('context closed'); }
  },
  fixtures: async ({}, use, testInfo) => {
    if (testInfo.title.includes('544 dirty aggregates')) console.log('P07 ring setup: fixture servers starting');
    const server = await startFixtureServer();
    if (testInfo.title.includes('544 dirty aggregates')) console.log('P07 ring setup: fixture servers ready');
    try { await use(server); } finally { await server.close(); }
  },
});

export { expect } from '@playwright/test';
