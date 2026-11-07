// ADR-020 §G, REQ-013 (S12, E21-12 case 5): history settings in Options (#history) — volume indicator, retention
// 7/30/90 through the Options-only route, the export dialog (site-N by default; «Включить названия сайтов» shows the
// warning and the names) whose saved file is byte-for-byte the previewed text, and «Удалить всю историю» after a
// confirmation (Escape cancels, focus back on the button).

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { HistoryProjection } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { fixtureResult, openExtensionPage } from '../helpers';
import { dumpProtectDb, enableProtect, grantAllSites, launchProtect, protectRoute, protectState, standUrl } from './support';

async function rows(sw: Worker): Promise<number> {
  const r = await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
  return (r as unknown as { history: HistoryProjection }).history.rows.length;
}

test('history options: usage, retention, export = preview (sites redacted by default), clear', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    expect((await enableProtect(sw, ['history'])).state?.state).toBe('active');
    for (const host of ['www.example.com', 'www.example.net']) {
      const page = await ext.context.newPage();
      await page.goto(standUrl(server.origins[0]!, host, '/protect/history/site.html?receiver=tracker.example.org'));
      expect(await fixtureResult(page)).toMatchObject({ receiver: true });
    }
    await expect.poll(() => rows(sw), { timeout: 30_000 }).toBe(1);

    const options = await openExtensionPage(ext.context, sw, 'options.html#protect');
    const section = options.locator('[data-history-settings="on"]');
    await expect(section).toBeVisible();
    await expect(section.locator('[data-history-usage]')).toContainText('1');
    await expect(section.locator('[data-history-usage]')).toContainText('2');

    // Retention: radio group, Options-only setting.
    const retention = section.locator('[data-history-retention]');
    await expect(retention).toHaveAttribute('role', 'radiogroup');
    // The radio shows the stored value until the SW answers (click, not check: the choice is applied by the SW).
    await retention.locator('input[value="7"]').click();
    await expect.poll(async () => (await protectState(sw)).historyRetentionDays).toBe(7);
    await expect(retention.locator('input[value="7"]')).toBeChecked();

    // Export: the preview has site-N; ticking the box shows the warning and the names; the file = the shown text.
    await section.locator('[data-history-export]').click();
    const dialog = options.locator('#history-export-dialog');
    const json = dialog.locator('[data-history-export-json]');
    await expect(json).toContainText('"sitesIncluded": false');
    await expect(json).toContainText('site-1');
    await expect(json).not.toContainText('example.com');
    await dialog.locator('[data-history-export-sites]').check();
    await expect(dialog.locator('[data-history-export-warning]')).toBeVisible();
    await expect(json).toContainText('"sitesIncluded": true');
    await expect(json).toContainText('example.com');
    await dialog.locator('[data-history-export-sites]').uncheck();
    await expect(json).toContainText('"sitesIncluded": false');
    const shown = (await json.textContent()) ?? '';
    const [download] = await Promise.all([options.waitForEvent('download'), dialog.locator('[data-history-export-save]').click()]);
    expect(download.suggestedFilename()).toMatch(/^detect-expert-history-\d{4}-\d\d-\d\d\.json$/);
    const saved = readFileSync((await download.path())!, 'utf8');
    expect(saved).toBe(shown);
    await expect(dialog).toHaveCount(0);
    await expect(section.locator('[data-history-export]')).toBeFocused();

    // Clear: Escape cancels (focus back), confirm deletes every history record.
    const clear = section.locator('[data-history-clear]');
    await clear.click();
    const confirm = options.locator('#history-clear-confirm');
    await expect(confirm).toBeVisible();
    await options.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(clear).toBeFocused();
    await clear.click();
    await confirm.locator('.button--primary').click();
    await expect(section.locator('[data-history-notice]')).not.toHaveText('');
    const dump = await dumpProtectDb(sw);
    for (const store of ['sightings', 'receivers', 'sites']) expect(dump[store] ?? [], store).toEqual([]);
    expect(await rows(sw)).toBe(0);
    await options.close();
  } finally {
    await ext.close();
    await server.close();
  }
});
