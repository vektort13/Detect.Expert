// ADR-020 §B, §8 (S07): a service-worker restart in real Chromium. The fingerprints were in SW memory only, so the
// new worker has a new salt; the lane tells the documents that held module state to re-key, the page's protect.js
// re-reads its fields under the new salt (a protect-input with another saltId), matching works again, and the evidence
// recorded before the restart comes back from storage.session.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Worker } from '@playwright/test';
import { repoRoot } from '../harness';
import { openExtensionPage } from '../helpers';
import { workerControl } from '../sw-restart/probe';
import { isolatedWire } from './support';
import type { Canary } from './support';
import { evidenceWhere, launchValueMatchStand, openForm, protectReport, transfers, typeAndLeave } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;

function saltIds(wire: string[]): string[] {
  return [...new Set(wire.map((m) => JSON.parse(m) as { type?: string; saltId?: string }).filter((m) => m.type === 'protect-input' && typeof m.saltId === 'string').map((m) => m.saltId!))];
}

test('SW restart: new salt, rekey, matching again; earlier evidence restored from storage.session', async () => {
  test.setTimeout(180_000);
  const stand = await launchValueMatchStand();
  try {
    const form = await openForm(stand, 'pixel-hash-on-blur.html');
    const wire = await isolatedWire(form.page, stand.sw);
    await typeAndLeave(stand, form, '#email', EMAIL);
    await evidenceWhere(stand.sw, form.tabId, (e) => e.receiver === 'example.net' && e.deliveryState === 'sent', 'evidence before the restart');
    const before = saltIds(await wire.read());
    expect(before).toHaveLength(1);
    // The doc-store writes storage.session debounced (500 ms): wait until the record is persisted before the stop.
    await expect.poll(() => stand.sw.evaluate(async () => {
      const all = await chrome.storage.session.get(null);
      return Object.entries(all).some(([k, v]) => k.startsWith('protect-doc:') && JSON.stringify(v).includes('"deliveryState":"sent"'));
    }), { message: 'evidence persisted in storage.session' }).toBe(true);

    const ui = await openExtensionPage(stand.ext.context, stand.sw, 'popup.html');
    const control = await workerControl(ui, stand.sw);
    await control.stop();
    await ui.evaluate(() => { void chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' }); });
    let sw: Worker | undefined;
    await expect.poll(async () => {
      for (const w of [...stand.ext.context.serviceWorkers()].reverse()) {
        try {
          const ok = await w.evaluate(() => typeof (globalThis as unknown as { __protectHarness?: unknown }).__protectHarness === 'object');
          if (ok) {
            sw = w;
            return true;
          }
        } catch {
          // the stopped worker's handle
        }
      }
      return false;
    }, { timeout: 20_000, message: 'restarted service worker' }).toBe(true);
    const restarted = sw!;
    // Earlier evidence comes back from storage.session.
    await expect.poll(async () => (await transfers(restarted, form.tabId).catch(() => [])).length, { timeout: 15_000, message: 'restored evidence' }).toBeGreaterThanOrEqual(1);
    // The document re-keys: a protect-input under another salt.
    await expect.poll(async () => saltIds(await wire.read()).length, { timeout: 15_000, message: 'protect-input under a new salt' }).toBe(2);
    expect(saltIds(await wire.read())[1]).not.toBe(before[0]);
    // Matching works again: the pixel fires on the next blur.
    await form.page.locator('#email').click();
    await form.page.locator('#title').click();
    await expect.poll(async () => (await transfers(restarted, form.tabId)).reduce((n, e) => n + e.count, 0), { timeout: 15_000, message: 'a second matched request' }).toBeGreaterThanOrEqual(2);
    expect((await protectReport(restarted, form.tabId)).limitations).not.toContain('values-reset');
  } finally {
    await stand.close();
  }
});
