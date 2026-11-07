// Shared helpers of the module «Защита» e2e specs (ADR-020, S05). The module is driven through the DevTools-only
// harness of the test profiles (`__protectHarness`, S04): enable/disable go through the same validated ui-protect-*
// route as the Options page (an Options sender is synthesized in the SW entry). S06 brings the consent screen in
// Options; enableProtect switches to that path there. Host grants follow tests/extension/permissions/support.ts
// (chrome://extensions approval + the real Options scope form). Trusted ids always come from Chrome, never a page.

import { createHash } from 'node:crypto';
import { expect, type Frame, type Page, type Worker } from '@playwright/test';
import type { ProtectState } from '@detect-expert/contracts';
import { extensionIdOf, launch, type ExtensionSession } from '../harness';
import { openExtensionPage } from '../helpers';
import { ALL, applyOptions, reconcile } from '../permissions/support';

/** Fixture-only names resolved to loopback without DNS traffic (as the S01 spike and the S08 stand). */
export const PROTECT_RESOLVER = 'MAP *.example.com 127.0.0.1, MAP *.example.net 127.0.0.1, MAP *.example.org 127.0.0.1';
export const OBSERVATION_SCRIPT_IDS = ['detector-isolated-v1', 'detector-main-v1'] as const;
export const PROTECT_SCRIPT_IDS = ['detector-protect-isolated-v1', 'detector-protect-main-v1'] as const;
export const PROTECT_DB = 'detect-expert-protect';
/** Our DNR id ranges (packages/contracts/src/protect.ts DNR_RULE_IDS), for "no rule of ours" checks. */
export const OUR_DNR_RANGES: ReadonlyArray<readonly [number, number]> = [[1, 99], [100000, 100999], [101000, 101023], [200000, 200127]];
export const NO_LISTENERS = { beforeRequestTabs: [], sendHeaders: false, requestHeaders: false, errorOccurred: false, completed: false };

export interface RegisteredScript {
  id: string;
  js: string[];
  world: string;
  matches: string[];
  excludeMatches: string[];
  allFrames: boolean;
  runAt: string;
}

export interface ProtectStateResponse {
  type: string;
  state?: ProtectState;
  code?: string;
}

export interface TripwireCounters {
  hits: number;
  selfCheck: number;
  nonPasswordReads: number;
}

export interface Canary {
  id: string;
  value: string;
}

export async function launchProtect(options: { profile?: 'test' | 'test-optional' } = {}): Promise<ExtensionSession> {
  return launch({ profile: options.profile ?? 'test', hostResolverRules: PROTECT_RESOLVER });
}

/** http://<host>:<port of the stand origin>/<path> (host-resolver maps *.example.{com,net,org} to the stand). */
export function standUrl(origin: string, host: string, path: string): string {
  const url = new URL(origin);
  url.hostname = host;
  return url.origin + path;
}

/**
 * Broad host grant (the module needs every site, ADR-020 §7): chrome://extensions approves http(s)://*\/*, then the
 * real Options scope form requests it in a click (no native prompt for approved hosts). Observation becomes
 * all-sites; its two registrations must be present (the module's own may be there too).
 */
export async function grantAllSites(ext: ExtensionSession, sw: Worker): Promise<void> {
  const settings = await ext.context.newPage();
  try {
    await settings.goto('chrome://extensions');
    await settings.evaluate(async ({ id, patterns }) => {
      const api = (chrome as unknown as { developerPrivate: { addHostPermission(id: string, host: string): Promise<void> } }).developerPrivate;
      for (const pattern of patterns) await api.addHostPermission(id, pattern);
    }, { id: extensionIdOf(sw), patterns: ALL });
  } finally {
    await settings.close();
  }
  const options = await openExtensionPage(ext.context, sw, 'options.html');
  try {
    await applyOptions(options, 'all-sites');
    await expect.poll(() => sw.evaluate((patterns) => chrome.permissions.contains({ origins: patterns }), ALL)).toBe(true);
    expect(await reconcile(sw, ALL)).toBe(true);
    await expect.poll(async () => (await registeredScripts(sw, [...OBSERVATION_SCRIPT_IDS])).map((s) => s.id).sort()).toEqual([...OBSERVATION_SCRIPT_IDS]);
  } finally {
    await options.close();
  }
}

/** Real removal of the broad grant from the SW (permissions.remove; the observation scope reacts as in the P05 matrix). */
export async function revokeAllSites(sw: Worker): Promise<boolean> {
  return sw.evaluate((origins) => chrome.permissions.remove({ origins }), ALL);
}

type HarnessCall = 'enable' | 'disable' | 'route' | 'setManaged' | 'state' | 'listeners' | 'registered';

/** Calls a method of the SW's `__protectHarness` (test profiles only). */
export async function harness<T>(sw: Worker, method: HarnessCall, ...args: unknown[]): Promise<T> {
  return sw.evaluate(async ({ m, a }) => {
    const h = (globalThis as unknown as { __protectHarness?: Record<string, (...x: unknown[]) => unknown> }).__protectHarness;
    if (h === undefined) throw new Error('__protectHarness is missing (test profiles only)');
    const fn = h[m];
    if (typeof fn !== 'function') throw new Error('__protectHarness.' + m + ' is missing');
    return (await fn(...a)) as unknown;
  }, { m: method, a: args }) as Promise<T>;
}

/** ui-protect-enable through the Options route of the harness (consent version 1). Until S06 there is no UI path. */
export async function enableProtect(sw: Worker, features: string[], preset = 'normal'): Promise<ProtectStateResponse> {
  return harness<ProtectStateResponse>(sw, 'enable', features, preset);
}

export async function disableProtect(sw: Worker, purge: boolean): Promise<ProtectStateResponse> {
  return harness<ProtectStateResponse>(sw, 'disable', purge);
}

export async function protectRoute(sw: Worker, request: Record<string, unknown>): Promise<ProtectStateResponse & Record<string, unknown>> {
  return harness(sw, 'route', { schemaVersion: 1, ...request });
}

export async function protectState(sw: Worker): Promise<ProtectState> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-state' });
  if (r.type !== 'protect-state' || r.state === undefined) throw new Error('ui-protect-get-state answered ' + JSON.stringify(r));
  return r.state;
}

export async function protectListeners(sw: Worker): Promise<Record<string, unknown>> {
  return harness(sw, 'listeners');
}

/** Registered content scripts as Chrome reports them (optionally only `ids`). */
export async function registeredScripts(sw: Worker, ids?: string[]): Promise<RegisteredScript[]> {
  return sw.evaluate(async (filter) => {
    const all = await chrome.scripting.getRegisteredContentScripts(filter === null ? undefined : { ids: filter });
    return all.map((s) => ({
      id: s.id,
      js: [...(s.js ?? [])],
      world: String(s.world ?? ''),
      matches: [...(s.matches ?? [])],
      excludeMatches: [...(s.excludeMatches ?? [])].sort(),
      allFrames: s.allFrames === true,
      runAt: String(s.runAt ?? ''),
    }));
  }, ids ?? null);
}

export async function registeredIds(sw: Worker): Promise<string[]> {
  return (await registeredScripts(sw)).map((s) => s.id).sort();
}

export async function databases(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () => (await indexedDB.databases()).map((d) => String(d.name)));
}

/** Every record of every store of the module database; {} when the database does not exist (never creates it). */
export async function dumpProtectDb(sw: Worker): Promise<Record<string, unknown[]>> {
  return sw.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return {};
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => req.transaction?.abort();
    });
    try {
      const out: Record<string, unknown[]> = {};
      for (const store of Array.from(db.objectStoreNames)) {
        out[store] = await new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result as unknown[]);
          req.onerror = () => reject(req.error);
        });
      }
      return out;
    } finally {
      db.close();
    }
  }, PROTECT_DB);
}

/** DNR rules of ours (our id ranges) or [] when the namespace is absent (no optional DNR grant). */
export async function ourDnrRules(sw: Worker): Promise<{ api: boolean; ids: number[] }> {
  return sw.evaluate(async (ranges) => {
    const dnr = (chrome as unknown as { declarativeNetRequest?: { getDynamicRules(): Promise<Array<{ id: number }>>; getSessionRules(): Promise<Array<{ id: number }>> } }).declarativeNetRequest;
    if (dnr === undefined) return { api: false, ids: [] };
    const rules = [...(await dnr.getDynamicRules()), ...(await dnr.getSessionRules())];
    return { api: true, ids: rules.map((r) => r.id).filter((id) => ranges.some(([lo, hi]) => id >= lo && id <= hi)) };
  }, OUR_DNR_RANGES.map((r): [number, number] => [r[0], r[1]]));
}

/** Tripwire counters of one document (test profile): null for a world whose tripwire did not run there. */
export async function tripwire(target: Page | Frame): Promise<{ isolated: TripwireCounters | null; main: TripwireCounters | null }> {
  const raw = await target.evaluate(() => ({ isolated: document.documentElement.dataset['pwTripwireIsolated'] ?? null, main: document.documentElement.dataset['pwTripwireMain'] ?? null }));
  const parse = (s: string | null): TripwireCounters | null => (s === null ? null : (JSON.parse(s) as TripwireCounters));
  return { isolated: parse(raw.isolated), main: parse(raw.main) };
}

/** Types like a user (CDP key events: trusted input). Never fill(): the page's value is not touched by the test. */
export async function typeInto(page: Page, target: ReturnType<Page['locator']>, text: string): Promise<void> {
  await target.click();
  await page.keyboard.type(text, { delay: 5 });
}

/**
 * Captures the module messages protect.js sends to the SW: chrome.runtime.sendMessage of the extension's ISOLATED
 * world of the top frame is wrapped through DevTools (as tests/extension/sw-restart/probe.ts does for the bridge).
 * Only messages whose type starts with `protect-` are kept, as JSON strings.
 */
export async function isolatedWire(page: Page, sw: Worker): Promise<{ read(): Promise<string[]> }> {
  const cdp = await page.context().newCDPSession(page);
  const extensionOrigin = 'chrome-extension://' + extensionIdOf(sw);
  let contextId = 0;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    const aux = context.auxData as { isDefault?: boolean; frameId?: string } | undefined;
    if (context.origin === extensionOrigin && aux?.isDefault === false && contextId === 0) contextId = context.id;
  });
  await cdp.send('Runtime.enable');
  await expect.poll(() => contextId, { message: 'ISOLATED world of the extension in the page' }).toBeGreaterThan(0);
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await cdp.send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value as T;
  };
  await evaluate(`(() => {
    if (globalThis.__s05Wire) return true;
    globalThis.__s05Wire = [];
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = function (...args) {
      try {
        const m = args[0];
        if (m && typeof m.type === 'string' && m.type.startsWith('protect-')) globalThis.__s05Wire.push(JSON.stringify(m));
      } catch {}
      return Reflect.apply(original, chrome.runtime, args);
    };
    return true;
  })()`);
  return { read: () => evaluate<string[]>('globalThis.__s05Wire.slice()') };
}

/** Records the module channel (window messages on detect.expert/protect/v1) in the page's MAIN world, as strings. */
export async function captureModuleChannel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__s05Channel', { value: seen, configurable: true });
    window.addEventListener('message', (event) => {
      const data = event.data as { channel?: unknown } | null;
      if (data !== null && typeof data === 'object' && data.channel === 'detect.expert/protect/v1' && seen.length < 512) seen.push(JSON.stringify(data));
    });
  });
}

export async function moduleChannel(target: Page | Frame): Promise<string[]> {
  return target.evaluate(() => [...((window as unknown as { __s05Channel?: string[] }).__s05Channel ?? [])]);
}

/** A canary and its variants (md5/sha1/sha256/sha512 hex and base64, URL-encoded, Base64): never allowed anywhere. */
export function canaryVariants(value: string): string[] {
  const out = new Set<string>([value, encodeURIComponent(value), Buffer.from(value, 'utf8').toString('base64')]);
  for (const algo of ['md5', 'sha1', 'sha256', 'sha512']) {
    out.add(createHash(algo).update(value, 'utf8').digest('hex'));
    out.add(createHash(algo).update(value, 'utf8').digest('base64'));
    out.add(createHash(algo).update(value.trim().toLowerCase(), 'utf8').digest('hex'));
  }
  return [...out];
}

/** Every canary variant found in `text` (empty = clean). */
export function canaryHits(text: string, canaries: readonly Canary[]): string[] {
  const hits: string[] = [];
  for (const c of canaries) for (const v of canaryVariants(c.value)) if (text.includes(v)) hits.push(c.id);
  return [...new Set(hits)];
}
