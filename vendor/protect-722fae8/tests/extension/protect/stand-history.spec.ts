// ADR-020 §B, §G (S15, E21-15): real value-match evidence on two sites → one row of the history «Кто вас узнаёт» with
// the mechanism value-match, two sites and confidence high (hash of an e-mail, sent per Chrome's onSendHeaders).
// No injected events: trusted typing on fixtures/protect/forms/pixel-hash-on-blur.html at www.example.com and at
// www.example.org; the page's own pixel goes to px.tracker.example.net (receiver example.net). The side panel tab
// «Кто узнаёт» shows the row. The IndexedDB dump holds domains, day numbers, enums and counts only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { HistoryProjection } from '@detect-expert/contracts';
import { repoRoot } from '../harness';
import { brief, openExtensionPage } from '../helpers';
import { canaryHits, dumpProtectDb, protectRoute } from './support';
import type { Canary } from './support';
import { evidenceWhere, launchValueMatchStand, openForm, typeAndLeave } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));

test('stand: value-match evidence on two sites → history row value-match, 2 sites, high', async () => {
  test.setTimeout(180_000);
  const stand = await launchValueMatchStand(['value-match', 'history']);
  try {
    let firstTab = -1;
    for (const [i, host] of ['www.example.com', 'www.example.org'].entries()) {
      const form = await openForm(stand, 'pixel-hash-on-blur.html', '', host);
      if (firstTab < 0) firstTab = form.tabId;
      await typeAndLeave(stand, form, '#email', EMAIL, i + 1); // one tracked field per document
      await evidenceWhere(stand.sw, form.tabId, (e) => e.receiver === 'example.net' && e.deliveryState === 'sent' && e.interpretationConfidence === 'high', 'sent evidence on ' + host);
    }

    const query = async (): Promise<HistoryProjection | null> => {
      const r = await protectRoute(stand.sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
      return r.type === 'protect-history' ? (r as unknown as { history: HistoryProjection }).history : null;
    };
    await expect.poll(async () => {
      const row = (await query())?.rows.find((x) => x.rowKey === 'd:example.net');
      return row?.mechanisms.find((m) => m.mechanism === 'value-match')?.sites ?? 0;
    }, { timeout: 30_000, message: 'history row d:example.net with value-match on two sites (flush ≤ 5 s)' }).toBe(2);
    const history = await query();
    const row = history?.rows.find((x) => x.rowKey === 'd:example.net');
    if (row === undefined) throw new Error('history row missing: ' + brief(history));
    expect(row.sites, brief(row)).toBe(2);
    expect(row.mechanisms.find((m) => m.mechanism === 'value-match'), brief(row)).toMatchObject({ sites: 2, interpretationConfidence: 'high', integrity: 'derived' });

    // The side panel «Кто узнаёт» lists the row (no value, no hash in the text).
    const panel = await openExtensionPage(stand.ext.context, stand.sw, 'sidepanel.html?tabId=' + String(firstTab));
    await panel.locator('#panel-tab-history').click();
    await expect(panel.locator('[data-history-row="d:example.net"]')).toHaveAttribute('data-history-sites', '2', { timeout: 15_000 });
    expect(canaryHits(await panel.locator('body').innerText(), FIELD_CANARIES)).toEqual([]);
    await panel.close();

    const dump = await dumpProtectDb(stand.sw);
    expect((dump['sightings'] ?? []).length).toBeGreaterThan(0);
    const text = JSON.stringify(dump);
    expect(canaryHits(text, FIELD_CANARIES)).toEqual([]);
    expect(text).not.toMatch(/https?:|\/tr\b|ud\[em\]/);
  } finally {
    await stand.close();
  }
});
