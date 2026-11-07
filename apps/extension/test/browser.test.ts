// Entry bundles in Chromium with a mocked extension API; no host grants or external traffic.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BridgeMessage, PageBatch, UiRequest } from '@detect-expert/contracts';
import { finding, report, technique } from '../../../packages/ui/test/fixtures';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
declare global {
  interface Window { extensionAudit: { hellos: BridgeMessage[]; batches: PageBatch[]; listeners: number } }
}

let browser: Browser;
let page: Page;
let panel: string;
let bridge: string;
let sensor: string;
beforeAll(async () => {
  const bundles = await Promise.all(['sidepanel/sidepanel.tsx', 'bridge.ts', 'hook.main.ts'].map(async (entry) =>
    (await build({ entryPoints: ['apps/extension/entrypoints/' + entry], bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact' })).outputFiles[0]!.text));
  panel = bundles[0]!;
  bridge = bundles[1]!;
  sensor = bundles[2]!;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
}, 30_000);
beforeEach(async () => { page = await browser.newPage(); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

describe('F083 / F084 bridge bootstrap (E04-02 #9)', () => {
  for (const order of ['bridge-first', 'sensor-first']) {
    it('reinjects both bundles with one session and unchanged coverage: ' + order, async () => {
      await page.evaluate(() => {
        window.extensionAudit = { hellos: [], batches: [], listeners: 0 };
        window.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
          if (event.data?.type === 'bridge-hello') window.extensionAudit.hellos.push(event.data);
        });
        Object.defineProperty(window, 'chrome', { value: { runtime: {
          id: 'test-extension',
          onMessage: { addListener: () => { window.extensionAudit.listeners++; } },
          sendMessage: async (batch: PageBatch) => {
            window.extensionAudit.batches.push(batch);
            return { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true };
          },
        } } });
      });
      if (order === 'sensor-first') await page.addScriptTag({ content: sensor });
      await page.addScriptTag({ content: bridge });
      await page.addScriptTag({ content: bridge });
      if (order === 'bridge-first') await page.addScriptTag({ content: sensor });
      await page.evaluate(() => { document.createElement('canvas').toDataURL(); });
      await page.waitForFunction(() => window.extensionAudit.batches.some((b) => b.observations.some((o) => o.count === 1)));
      const before = await page.evaluate(() => ({ hellos: window.extensionAudit.hellos.length,
        flags: [...new Set(window.extensionAudit.batches.flatMap((b) => b.coverageDelta))].sort() }));
      await page.addScriptTag({ content: bridge });
      await page.addScriptTag({ content: sensor });
      await page.evaluate(() => { document.createElement('canvas').toDataURL(); });
      await page.waitForFunction(() => window.extensionAudit.batches.some((b) => b.observations.some((o) => o.count === 2)));
      const after = await page.evaluate(() => ({
        sessions: [...new Set(window.extensionAudit.batches.map((b) => b.bridgeSessionId))],
        helloSessions: [...new Set(window.extensionAudit.hellos.filter((m) => m.type === 'bridge-hello').map((m) => m.bridgeSessionId))],
        hellos: window.extensionAudit.hellos.length,
        listeners: window.extensionAudit.listeners,
        flags: [...new Set(window.extensionAudit.batches.flatMap((b) => b.coverageDelta))].sort(),
        maxCount: Math.max(...window.extensionAudit.batches.flatMap((b) => b.observations.map((o) => o.count))),
      }));
      expect(after.sessions).toHaveLength(1);
      expect(after.helloSessions).toEqual(after.sessions);
      expect(after.listeners).toBe(1);
      expect(after.hellos).toBe(before.hellos);
      expect(after.flags).toEqual(before.flags);
      expect(after.flags).not.toContain('throttled');
      expect(after.maxCount).toBe(2);
    });
  }

  it('does not invoke an existing marker getter or construct a collector', async () => {
    await page.evaluate(() => {
      window.extensionAudit = { hellos: [], batches: [], listeners: 0 };
      Object.defineProperty(globalThis, Symbol.for('detect.expert/bridge/v1'), { get() { window.extensionAudit.listeners++; throw new Error('marker getter called'); } });
      Object.defineProperty(window, 'chrome', { get() { window.extensionAudit.listeners++; throw new Error('collector constructed'); } });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addScriptTag({ content: bridge });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.extensionAudit.listeners)).toBe(0);
  });
});

describe('F080 / F085 sidepanel reflow and overflow explanations (REQ-006 / spec V §7)', () => {
  for (const locale of ['ru', 'en']) {
    for (const lost of ['counters', 'hosts', 'findings', 'observations'] as const) {
      it(locale + ' shows a generic data limit for dropped ' + lost + ' at narrow widths', async () => {
        const table = JSON.parse(readFileSync('apps/extension/_locales/' + locale + '/messages.json', 'utf8')) as Table;
        const projection = report({ coverageState: 'degraded', coverageFlags: ['budget-exceeded', 'network-limited', 'frames-inaccessible'],
          dropped: { ...report().dropped, [lost]: 1 },
          techniques: [technique({ techniqueId: 'DET-002', countQuality: 'lower-bound' })],
          findings: [finding({ findingId: 'canvas', techniqueId: 'DET-002' })],
        });
        await page.setContent('<div id="root"></div>');
        await page.addStyleTag({ path: 'packages/ui/src/styles/ui.css' });
        await page.addStyleTag({ path: 'apps/extension/entrypoints/sidepanel/sidepanel.css' });
        await page.evaluate(({ table, locale, projection }) => {
          Object.defineProperty(window, 'chrome', { value: {
            i18n: {
              getUILanguage: () => locale,
              getMessage: (key: string, subs: string[] = []) => table[key]?.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => {
                const index = Number(table[key]?.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1;
                return subs[index] ?? '';
              }) ?? '',
            },
            runtime: { sendMessage: async (request: UiRequest) => request.type === 'ui-get-scope'
              ? { schemaVersion: 1, type: 'scope', scope: { scopeMode: 'site', hosts: ['example.com'], managed: false, grantedAllSites: false } }
              : { schemaVersion: 1, type: 'report', report: projection } },
            tabs: { query: async () => [{ id: 12, url: 'https://example.com/' }], onActivated: { addListener() {}, removeListener() {} } },
          } });
        }, { table, locale, projection });
        await page.addScriptTag({ content: panel });
        await expect.poll(() => page.locator('body').textContent()).toContain(table['coverage_flag_budget_exceeded']!.message);
        expect(await page.locator('#panel-coverage').textContent()).toContain(table['coverage_flag_budget_exceeded']!.message);
        for (const key of ['coverage_flag_network_limited', 'coverage_flag_frames_inaccessible']) {
          expect(await page.locator('#panel-coverage').textContent()).toContain(table[key]!.message);
        }
        // 320–400 DIP at 200% page zoom leaves 160–200 CSS px. This checks the layout dimensions,
        // not Chrome's native sidepanel shell or a claim of a manual branded-Chrome zoom run.
        for (const width of [160, 180, 200, 320]) {
          await page.setViewportSize({ width, height: 800 });
          for (const tab of ['overview', 'techniques', 'sources', 'limits']) {
            await page.locator('#panel-tab-' + tab).click();
            await page.locator('[role="tabpanel"]:visible details').evaluateAll((details) => {
              for (const detail of details) detail.setAttribute('open', '');
            });
            const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
            expect(dimensions.scroll, locale + '/' + lost + '/' + tab + '/' + width).toBeLessThanOrEqual(dimensions.client);
          }
        }
      }, 15_000);
    }
  }
});
