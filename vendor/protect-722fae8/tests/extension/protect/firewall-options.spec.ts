// ADR-020 §D (S09, E21-09 case 2): the firewall part of the shipped Options page (dist/test options.html#firewall,
// fixed SW replies): the «Защита» tab opens with the firewall heading focused, the search filters the rules
// (debounced), removing selected rules goes through a confirmation with the focus on «Отмена», the mode is applied
// only by its button (arrow keys through the radios send nothing). No horizontal overflow at 360 px.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, launch, repoRoot, type ExtensionSession } from '../harness';
import { fwRuleRows, fwState } from '../../../packages/ui/test/protect-firewall-support';
import { fwFixturePage, fwRequests, text } from './ui-fixture';

const test = base.extend<{ ext: ExtensionSession }>({
  ext: async ({}, use) => {
    const session = await launch({ locale: 'ru-RU', timezoneId: 'UTC' });
    try {
      await use(session);
    } finally {
      await session.close();
    }
  },
});

test('S09 Options: #firewall tab, search, removal with confirmation, mode by button', async ({ ext }) => {
  test.setTimeout(90_000);
  const rules = fwRuleRows(12);
  const page = await fwFixturePage(ext, 'options', { state: fwState(), reports: [], rules }, { width: 900, height: 900, hash: '#firewall' });
  await expect(page.getByRole('tab', { name: text('options_tab_protect') })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fw-rules-panel-title')).toBeFocused();
  await expect(page.locator('[data-fw-rule]')).toHaveCount(12);
  await expect(page.locator('[data-fw-today]')).toContainText(text('fw_counter_today', ['4']));
  // The module section keeps no mode of its own (the firewall part has it).
  await expect(page.locator('[data-protect-preset]')).toHaveCount(0);

  // Search: debounced, lowercase host, only matching rules.
  await page.locator('#fw-rules-search').fill('https://RCV1.example.net/x?y=1');
  await expect.poll(async () => (await fwRequests(page, 'ui-protect-list-rules')).at(-1)?.['domainFilter']).toBe('rcv1.example.net');
  await expect(page.locator('[data-fw-rule]')).toHaveCount(1);
  await page.locator('#fw-rules-search').fill('rcv1');
  await expect(page.locator('[data-fw-rule]')).toHaveCount(3); // rcv1, rcv10, rcv11
  expect((await fwRequests(page, 'ui-protect-list-rules')).every((r) => !String(r['domainFilter'] ?? '').includes('?'))).toBe(true);

  // Removal of the selected rules: confirmation first, focus on «Отмена», Escape keeps the rules.
  await page.locator('#fw-rules-all').check();
  await page.locator('[data-fw-remove-selected]').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: text('action_cancel'), exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await fwRequests(page, 'ui-protect-remove-rules')).toEqual([]);
  await page.locator('[data-fw-remove-selected]').click();
  await page.getByRole('alertdialog').getByRole('button', { name: text('fw_rules_remove_selected', ['3']) }).click();
  await expect.poll(async () => (await fwRequests(page, 'ui-protect-remove-rules')).length).toBe(1);
  const [removal] = await fwRequests(page, 'ui-protect-remove-rules');
  expect((removal!['ruleKeys'] as string[]).sort()).toEqual(rules.filter((r) => r.receiver.startsWith('rcv1')).map((r) => r.ruleKey).sort());
  await expect(page.locator('[data-fw-rules-message]')).toHaveText(text('fw_rules_removed', ['3']));
  await expect(page.locator('[data-fw-remove-selected]')).toBeFocused();

  // Mode: arrow keys through the radios send nothing; «Применить режим» sends the chosen preset once.
  await page.locator('#fw-mode-normal').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#fw-mode-strict')).toBeChecked();
  await expect(page.locator('#fw-mode-strict-warning')).toHaveText(text('fw_mode_strict_warning'));
  expect(await fwRequests(page, 'ui-protect-set-settings')).toEqual([]);
  await page.locator('[data-fw-mode-apply]').click();
  await expect.poll(() => fwRequests(page, 'ui-protect-set-settings')).toEqual([{ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }]);
  await expect(page.locator('[data-fw-rules-message]')).toHaveText(text('fw_mode_applied'));

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  // Evidence PNGs (not in the repository): the firewall part in both themes.
  const directory = path.join(repoRoot, 'test-results/protect-firewall');
  mkdirSync(directory, { recursive: true });
  await page.locator('#fw-rules-search').fill('');
  await expect(page.locator('[data-fw-rule]')).toHaveCount(9);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('#firewall').screenshot({ path: path.join(directory, 'fw-options-' + theme + '-360.png') });
  }
  await page.close();
});
