import { expect, type Page, type Worker } from '@playwright/test';
import { extensionIdOf, type ExtensionSession } from '../harness';
import { getScope, openExtensionPage, registeredScripts } from '../helpers';

export const SITE = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];
export const ALL = ['http://*/*', 'https://*/*'];

export async function applyOptions(ui: Page, mode: 'site' | 'all-sites') {
  await ui.locator('#options-scope-' + mode).check();
  if (mode === 'site') await ui.locator('#options-scope-host').fill('127.0.0.1');
  await ui.locator('form.scope button[type=submit]').click();
}

export async function reconcile(sw: Worker, origins: string[]): Promise<boolean> {
  return sw.evaluate((patterns) => (globalThis as unknown as {
    __p05: { reconcilePermissions(origins: string[]): Promise<boolean> };
  }).__p05.reconcilePermissions(patterns), origins);
}

/** Chromium settings approve hosts; a real Options request activates optional permissions afterwards.
 * Fallback only: this does not prove first-time native prompt acceptance. No prefs or API results are mocked.
 */
export async function grant(ext: ExtensionSession, sw: Worker, mode: 'site' | 'all-sites') {
  const origins = mode === 'site' ? SITE : ALL;
  const settings = await ext.context.newPage();
  try {
    await settings.goto('chrome://extensions');
    await settings.evaluate(async ({ id, patterns }) => {
      const api = (chrome as unknown as {
        developerPrivate: { addHostPermission(id: string, host: string): Promise<void> };
      }).developerPrivate;
      for (const pattern of patterns) await api.addHostPermission(id, pattern);
    }, { id: extensionIdOf(sw), patterns: origins });
  } finally { await settings.close(); }
  const options = await openExtensionPage(ext.context, sw, 'options.html');
  try {
    await applyOptions(options, mode);
    await expect.poll(() => getScope(options)).toMatchObject({ scopeMode: mode });
    expect(await sw.evaluate((patterns) => chrome.permissions.contains({ origins: patterns }), origins)).toBe(true);
    expect(await reconcile(sw, origins)).toBe(true);
    expect(await registeredScripts(sw)).toHaveLength(2);
  } finally { await options.close(); }
}

/** IDs remain visible without tabs/host permissions; never infer IDs from page payloads. */
export async function openTab(ext: ExtensionSession, sw: Worker, url: string) {
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!);
  const ui = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + tabId);
  return { page, tabId, ui };
}

export async function readbacks(page: Page, count = 3) {
  expect(await page.evaluate((n) => (window as unknown as { __readback(n: number): number }).__readback(n), count)).toBe(count);
}

/** Identity cannot cross realms: compare intrinsic source plus same-realm descriptor/value identity. */
export function descriptors() {
  return [
    [HTMLCanvasElement.prototype, 'toDataURL'], [HTMLCanvasElement.prototype, 'toBlob'],
    [CanvasRenderingContext2D.prototype, 'getImageData'], [CanvasRenderingContext2D.prototype, 'measureText'],
  ].map(([proto, key]) => {
    const object = proto as object;
    const name = key as string;
    const desc = Object.getOwnPropertyDescriptor(object, name)!;
    const fn = desc.value as (...args: unknown[]) => unknown;
    return { key: name, source: Function.prototype.toString.call(fn), toString: fn.toString(),
      name: fn.name, length: fn.length, configurable: desc.configurable, writable: desc.writable,
      enumerable: desc.enumerable, identity: Reflect.get(object, name) === fn };
  });
}

export async function watchStops(page: Page) {
  await page.evaluate(() => {
    const stops: string[] = [];
    Object.assign(window, { __p05Stops: stops });
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data?.channel === 'detect.expert/v1' && event.data.type === 'bridge-stop') stops.push(event.data.reason);
    });
  });
}

export async function expectStopped(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __p05Stops: string[] }).__p05Stops)).toContain('revoked');
}

/** Retained optional grant permits this isolated probe after app scope closes. Chrome supplies sender IDs. */
export async function rejectedBatch(sw: Worker, tabId: number) {
  const response = await sw.evaluate(async (id) => {
    const results = await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED',
      func: async () => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'sensor-events',
        sensorBootId: 'p05-stale-boot', bridgeSessionId: 'p05-stale-session', batchSeq: 1,
        observations: [{ techniqueId: 'DET-002', count: 17, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 0 }], coverageDelta: [] }),
    });
    return results[0]?.result as unknown;
  }, tabId);
  expect(response).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: true, protocolOk: true, stopReason: 'revoked' });
}
