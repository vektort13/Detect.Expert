// P02 / F171 / ADR-005: actual shutdown with a pending close cleanup, then event-driven TTL hydration.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, getServiceWorker, repoRoot, test } from './harness';
import { DET, observed, techniqueCount, waitForReport } from './helpers';

for (const retained of ['inactive', 'bound'] as const) {
test('TTL removes ' + retained + ' history after a stopped worker wakes on navigation', async ({ ext, fixtures }, testInfo) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  await page.evaluate(() => (window as unknown as { __readback(n: number): number }).__readback(1));
  const first = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  if (retained === 'inactive') {
    await page.goto(fixtures.origins[0] + '/reinstall.html?next');
    await waitForReport(ui, tabId, (r) => r.documentKey !== first.documentKey);
  }
  await expect.poll(() => sw.evaluate(async (key) => {
    const doc = (await chrome.storage.session.get(key))[key] as { meta?: { bound: boolean } } | undefined;
    return doc?.meta?.bound;
  }, 'doc:' + first.documentKey)).toBe(retained === 'bound');

  const cdp = await ext.context.newCDPSession(ui);
  let versionId: string | undefined;
  let stopped = false;
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const v of versions) {
      if (v.scriptURL === sw.url() && v.runningStatus === 'running') versionId = v.versionId;
      if (v.versionId === versionId && v.runningStatus === 'stopped') stopped = true;
    }
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versionId).toBeTruthy();
  await sw.evaluate(async (key) => {
    // Close normally deletes immediately. Interrupt that write to leave real retained history for TTL.
    const original = chrome.storage.session.remove.bind(chrome.storage.session);
    chrome.storage.session.remove = (async (keys: string | string[]) => {
      if ((Array.isArray(keys) ? keys : [keys]).includes(key)) {
        Object.assign(globalThis, { __ttlClosePending: true });
        await new Promise<void>(() => undefined);
      }
      return original(keys);
    }) as typeof chrome.storage.session.remove;
    // Only the next test-profile startup reads this; the live worker clock stays unchanged.
    await chrome.storage.local.set({ 'test:p02:time-offset': 601_000 });
  }, 'doc:' + first.documentKey);
  await page.close();
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __ttlClosePending?: boolean }).__ttlClosePending)).toBe(true);
  expect(await sw.evaluate(async (key) => key in await chrome.storage.session.get(key), 'doc:' + first.documentKey)).toBe(true);
  await cdp.send('ServiceWorker.stopWorker', { versionId: versionId! });
  await expect.poll(() => stopped).toBe(true);
  const wake = await ext.context.newPage();
  await wake.goto(fixtures.origins[0] + '/reinstall.html?wake');
  const restarted = await getServiceWorker(ext.context);
  // Playwright may reuse its Worker wrapper; the terminated worker's global must be gone.
  expect(await restarted.evaluate(() => (globalThis as unknown as { __ttlClosePending?: boolean }).__ttlClosePending)).toBeUndefined();
  await expect.poll(() => restarted.evaluate(async ({ key, tab }) => {
    const items = await chrome.storage.session.get(['doc:' + key, 'index']);
    const index = items['index'] as { bindings: Array<{ tabId: number }>; tabs: Array<{ tabId: number }>; evictedKeys?: string[] } | undefined;
    return { expired: !items['doc:' + key], resetMarker: !!index?.evictedKeys?.includes(key),
      noBinding: !!index && !index.bindings.some((b) => b.tabId === tab),
      noTab: !!index && !index.tabs.some((t) => t.tabId === tab) };
  }, { key: first.documentKey, tab: tabId })).toEqual({ expired: true, resetMarker: true, noBinding: true, noTab: true });
  await testInfo.attach('ttl-evidence', { body: JSON.stringify({ stopped, offsetMs: 601000, expired: true, indexConsistent: true }), contentType: 'application/json' });
  await cdp.detach();
});
}

test('local profile contains no P02 clock hook or storage override key', () => {
  const local = readFileSync(path.join(repoRoot, 'dist/local/background.js'), 'utf8');
  expect(local).not.toContain('test:p02:time-offset');
  expect(local).not.toContain('__p02');
  const testBundle = readFileSync(path.join(repoRoot, 'dist/test/background.js'), 'utf8');
  expect(testBundle).toContain('test:p02:time-offset');
  expect(testBundle).toContain('__p02');
});
