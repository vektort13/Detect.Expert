// P02 / A10 / ADR-011: real Chrome session memory quota; no synthetic storage rejection.
import { TECHNIQUE_IDS } from '@detect-expert/contracts';
import type { Ack, PageBatch } from '@detect-expert/contracts';
import { expect, test } from './harness';
import { observed, waitForReport } from './helpers';

interface Probe {
  attempts: number;
  failures: number;
  removed: string[];
  measured: number;
}

test('real session quota degrades, evicts LRU, bounds retries and recovers', async ({ ext, fixtures }, testInfo) => {
  const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/reinstall.html');
  const oldest = await waitForReport(ui, tabId, () => true);
  await page.goto(fixtures.origins[0] + '/reinstall.html?second');
  const second = await waitForReport(ui, tabId, (r) => r.documentKey !== oldest.documentKey);
  await page.goto(fixtures.origins[0] + '/reinstall.html?active');
  const active = await waitForReport(ui, tabId, (r) => r.documentKey !== second.documentKey);
  // Let debounced lifecycle writes finish before filling the real storage area.
  await page.waitForTimeout(1100);
  const fill = await sw.evaluate(async () => {
    const storage = chrome.storage.session;
    const quota = storage.QUOTA_BYTES;
    await storage.set({ 'p02:junk': 'x'.repeat(Math.floor(9.5 * 1024 * 1024)) });
    const initial = await storage.getBytesInUse(null);
    // 9.5 MiB triggers the product's 4 MiB budget but leaves room under Chrome's 10 MiB quota.
    // Top off by binary search so a bounded report growth actually reaches Chrome's rejection path.
    let low = 0;
    let high: number = quota;
    let rejections = 0;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      try {
        await storage.set({ 'p02:tail': 'y'.repeat(mid) });
        low = mid;
      } catch (error) {
        if (!/quota/i.test(String(error))) throw error;
        high = mid;
        rejections++;
      }
    }
    return { initial, full: await storage.getBytesInUse(null), quota, rejections };
  });
  expect(fill.initial).toBeGreaterThanOrEqual(9.5 * 1024 * 1024);
  expect(fill.full).toBeLessThanOrEqual(fill.quota);
  expect(fill.quota - fill.full).toBeLessThan(64);
  expect(fill.rejections).toBeGreaterThan(0);
  await sw.evaluate((key) => {
    const storage = chrome.storage.session;
    const probe = { attempts: 0, failures: 0, removed: [] as string[], measured: 0 };
    Object.assign(globalThis, { __quotaProbe: probe });
    const set = storage.set.bind(storage);
    storage.set = (async (items: Record<string, unknown>) => {
      if (items['doc:' + key]) probe.attempts++;
      try { await set(items); } catch (error) {
        if (items['doc:' + key] && /quota/i.test(String(error))) probe.failures++;
        throw error;
      }
    }) as typeof storage.set;
    const remove = storage.remove.bind(storage);
    storage.remove = (async (keys: string | string[]) => {
      probe.removed.push(...(Array.isArray(keys) ? keys : [keys]));
      return remove(keys);
    }) as typeof storage.remove;
    const bytes = storage.getBytesInUse.bind(storage);
    storage.getBytesInUse = (async (keys: string | string[] | null) => {
      probe.measured++;
      return bytes(keys);
    }) as typeof storage.getBytesInUse;
  }, active.documentKey);
  const batch: PageBatch = {
    schemaVersion: 1, type: 'sensor-events', sensorBootId: 'p02-quota', bridgeSessionId: 'p02-quota', batchSeq: 1,
    observations: TECHNIQUE_IDS.slice(0, 32).map((techniqueId) => ({
      techniqueId, count: 7, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1,
    })), coverageDelta: [],
  };
  const send = () => sw.evaluate(async ({ id, batch }) => {
    const result = await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED',
      func: async (payload: PageBatch) => chrome.runtime.sendMessage(payload) as Promise<Ack>, args: [batch],
    });
    return result[0]!.result!;
  }, { id: tabId, batch });
  const ack = await send();
  expect(ack.lastCommittedBatchSeq).toBe(0);
  const report = await waitForReport(ui, tabId, (r) => r.coverageState === 'degraded');
  expect(report.coverageFlags).toContain('truncated');
  const probe = await sw.evaluate(() => (globalThis as unknown as { __quotaProbe: Probe }).__quotaProbe);
  expect(probe.failures).toBe(3);
  expect(probe.attempts).toBe(3);
  expect(probe.removed.indexOf('doc:' + oldest.documentKey)).toBeGreaterThanOrEqual(0);
  expect(probe.removed.indexOf('doc:' + oldest.documentKey)).toBeLessThan(probe.removed.indexOf('doc:' + second.documentKey));
  for (let i = 0; i < 4; i++) expect((await send()).lastCommittedBatchSeq).toBe(0);
  expect(await sw.evaluate(() => (globalThis as unknown as { __quotaProbe: Probe }).__quotaProbe.attempts)).toBe(3);
  await sw.evaluate(() => {
    (globalThis as unknown as { __p02: { advanceTime(ms: number): void } }).__p02.advanceTime(5000);
  });
  await sw.evaluate(() => chrome.storage.session.remove(['p02:junk', 'p02:tail']));
  expect((await send()).lastCommittedBatchSeq).toBe(1);
  const saved = await sw.evaluate(async (key) => {
    const items = await chrome.storage.session.get(['doc:' + key, 'index']);
    const doc = items['doc:' + key] as { report: { watermark: { lastCommittedBatchSeq: number }; counters: Array<{ count: number }>; coverageFlags: string[] } };
    return { watermark: doc.report.watermark.lastCommittedBatchSeq, counts: doc.report.counters.map((c) => c.count),
      flags: doc.report.coverageFlags, bytes: await chrome.storage.session.getBytesInUse(null) };
  }, active.documentKey);
  expect(saved.watermark).toBe(1);
  expect(saved.counts.filter((n) => n === 7)).toHaveLength(32);
  expect(saved.flags).toContain('truncated'); // Recovery does not erase historical loss.
  expect(saved.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __quotaProbe: Probe }).__quotaProbe.measured)).toBeGreaterThan(0);
  const evidence = { fill, failure: probe, recovery: saved };
  console.log('P02 quota evidence: ' + JSON.stringify(evidence));
  await testInfo.attach('quota-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
});
