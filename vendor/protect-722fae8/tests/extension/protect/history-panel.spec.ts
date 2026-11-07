// ADR-020 §G (S12, E21-12 case 2): the side-panel tab «Кто узнаёт» in a real Chromium — roles (radiogroup, list,
// expandable card), keyboard (arrow keys in the period group, Enter on «Подробнее», Escape in the confirmation with the
// focus back on its button, deletion with the focus on the list heading), «На этом сайте», and the light and dark
// themes (palette tokens of ui.css). Locale-independent locators (ids and data attributes).

import { expect, test } from '@playwright/test';
import type { Page, Worker } from '@playwright/test';
import type { HistoryProjection } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

async function query(sw: Worker): Promise<HistoryProjection> {
  const r = await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
  return (r as unknown as { history: HistoryProjection }).history;
}

async function background(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

test('history panel: roles, keyboard, this site, deletion with focus, light and dark themes', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    expect((await enableProtect(sw, ['history'])).state?.state).toBe('active');
    let comTab = -1;
    for (const host of ['www.example.com', 'www.example.net']) {
      const page = await ext.context.newPage();
      await page.goto(standUrl(server.origins[0]!, host, '/protect/history/site.html?receiver=tracker.example.org'));
      expect(await fixtureResult(page)).toMatchObject({ receiver: true });
      if (host === 'www.example.com') comTab = await tabIdOf(sw, page.url());
    }
    await expect.poll(async () => (await query(sw)).rows.map((r) => [r.rowKey, r.sites]), { timeout: 30_000 }).toEqual([['d:example.org', 2]]);

    const panel = await openExtensionPage(ext.context, sw, 'sidepanel.html?tabId=' + String(comTab));
    await panel.emulateMedia({ colorScheme: 'light' });
    const tab = panel.locator('#panel-tab-history');
    await expect(tab).toHaveAttribute('role', 'tab');
    await tab.click();
    const root = panel.locator('[data-history-panel="on"]');
    await expect(root).toBeVisible();
    const row = panel.locator('[data-history-row="d:example.org"]');
    await expect(row).toHaveAttribute('data-history-sites', '2');
    await expect(panel.locator('[data-history-this-site="example.com"]')).toContainText('example.org');
    await expect(panel.locator('[data-history-coverage-line="since"]')).toHaveCount(1);
    // all-sites observation: no scope warning.
    await expect(panel.locator('[data-history-coverage-line="scope"]')).toHaveCount(0);

    // Period: a radio group; arrow keys move the choice (native radios) and the list reloads.
    const group = panel.getByRole('radiogroup').first();
    await expect(group.getByRole('radio')).toHaveCount(3);
    const thirty = group.locator('input[value="30"]');
    await expect(thirty).toBeChecked();
    await thirty.focus();
    await panel.keyboard.press('ArrowRight');
    await expect(group.locator('input[value="90"]')).toBeChecked();
    await expect(row).toBeVisible();

    // Details: a disclosure button (aria-expanded / aria-controls) opened with Enter.
    const details = row.locator('[data-history-details]');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await details.focus();
    await panel.keyboard.press('Enter');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    const card = panel.locator('[data-history-card="d:example.org"]');
    await expect(card.locator('[data-history-site]')).toHaveCount(2);
    await expect(card.locator('[data-history-mechanism="frame-techniques"]')).toHaveCount(1);

    // Themes: the row surface follows the palette tokens (light #ffffff, dark #14171b).
    expect(await background(panel, '.history-row')).toBe('rgb(255, 255, 255)');
    await panel.emulateMedia({ colorScheme: 'dark' });
    expect(await background(panel, '.history-row')).toBe('rgb(20, 23, 27)');
    expect(await background(panel, '.history-card')).toBe('rgb(29, 34, 40)');
    await panel.emulateMedia({ colorScheme: 'light' });

    // Delete the row: Escape cancels and the focus returns to the button; confirming removes it and the focus moves to
    // the list heading.
    const deleteRow = card.locator('[data-history-delete-row]');
    await deleteRow.click();
    const dialog = panel.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(deleteRow).toBeFocused();
    await deleteRow.click();
    await dialog.locator('.button--primary').click();
    await expect(panel.locator('[data-history-row]')).toHaveCount(0);
    await expect(panel.locator('#history-list-title')).toBeFocused();
    await expect(panel.locator('[data-history-empty]')).toBeVisible();
    const after = await query(sw);
    expect(after.rows, brief(after)).toEqual([]);
    await panel.close();
  } finally {
    await ext.close();
    await server.close();
  }
});
