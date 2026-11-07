// P11 / ADR-003 / REQ-006: actual toolbar activeTab grant, no static or mocked host access.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { UiRequest } from '@detect-expert/contracts';
import { test as base, expect, launch, getServiceWorker, extensionIdOf, repoRoot } from '../harness';
import { getScope, registeredScripts, waitForReport } from '../helpers';
import { openTab } from '../permissions/support';
import { messages } from './fixture';

const test = base.extend({
  ext: async ({}, use) => {
    const session = await launch({ profile: 'test-optional', extensionActionDebugging: true, locale: 'ru-RU', timezoneId: 'UTC' });
    try { await use(session); } finally { await session.close(); }
  },
});

for (const locale of ['en', 'ru']) test('P11 ' + locale + ' fresh install: visible activation at 360px, ui-inject-now and real late-start', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const { page, ui, tabId } = await openTab(ext, sw, fixtures.origins[0] + '/reinstall.html');
  expect((await getScope(ui)).scopeMode).toBe('off');
  expect((await sw.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
  expect(await registeredScripts(sw)).toEqual([]);
  const cdp = await ext.context.browser()!.newBrowserCDPSession();
  try {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find((entry) => entry.url === page.url());
    expect(target).toBeDefined();
    await page.bringToFront();
    await cdp.send('Extensions.triggerAction', { id: extensionIdOf(sw), targetId: target!.targetId });
  } finally { await cdp.detach(); }
  await ui.setViewportSize({ width: 360, height: 600 });
  await ui.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  if (locale === 'ru') await ui.addInitScript((messages) => {
    // Headless Chromium chooses English extension messages despite context.locale.
    // Select the shipped Russian table only; all permission and SW APIs remain real.
    chrome.i18n.getUILanguage = () => 'ru';
    chrome.i18n.getMessage = ((key: string, subs: string[] = []) => {
      const entry = messages[key];
      return entry?.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => {
        const content = entry.placeholders?.[name.toLowerCase()]?.content ?? '';
        return subs[Number(content.slice(1)) - 1] ?? '';
      }) ?? '';
    }) as typeof chrome.i18n.getMessage;
  }, messages);
  await ui.reload();
  await expect(ui.locator('[data-scope-activation]')).toBeVisible();
  await expect(ui.locator('[aria-labelledby="findings-title"]')).toBeAttached();
  await expect(ui.locator('.host')).toHaveText('127.0.0.1');
  for (const mode of ['active-tab', 'site', 'all-sites']) {
    const option = ui.locator('#popup-scope-' + mode);
    await expect(option).toBeVisible();
    await expect(option).toBeEnabled();
    expect(await option.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[aria-labelledby="findings-title"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  }
  expect(await ui.locator('[data-scope-activation]').evaluate((element) => element.previousElementSibling?.id)).toBe('coverage');
  await expect(ui.locator('[data-scope-activation] details')).toHaveCount(0);
  const apply = ui.locator('form.scope button[type=submit]');
  await expect(apply).toHaveText(locale === 'ru' ? 'Проверять с этого момента' : 'Check from now on');
  await expect(apply).toHaveClass(/button--primary/);
  await expect(apply).toBeInViewport({ ratio: 1 });
  expect(await ui.evaluate(() => scrollY)).toBe(0);
  const directory = path.join(repoRoot, 'tests/extension/popup/__screenshots__');
  mkdirSync(directory, { recursive: true });
  const file = 'fresh-install-' + locale + '-light-360.png';
  const png = await ui.screenshot({ path: path.join(directory, file) });
  writeFileSync(path.join(directory, 'P11-' + locale + '.json'), JSON.stringify({
    requirement: 'P11 / ADR-003', browser: ext.context.browser()!.version(), width: 360, height: 600,
    locale, source: 'Профиль test-optional без host grants; настоящее действие toolbar через CDP, popup.html с test-only tabId; ответы SW не подменены. RU выбирает поставляемую таблицу через тестовый i18n override, EN использует Chrome i18n.',
    file, sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length,
  }, null, 2) + '\n');
  await ui.evaluate(() => {
    const requests: UiRequest[] = [];
    Object.assign(window, { __p11Requests: requests });
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    // Record the real wire call, preserving its arguments and returned Promise.
    chrome.runtime.sendMessage = ((request: UiRequest) => { requests.push(request); return send(request); }) as typeof chrome.runtime.sendMessage;
  });
  await apply.click();
  await expect.poll(() => ui.evaluate(() => (window as unknown as { __p11Requests: UiRequest[] }).__p11Requests.filter((request) => request.type === 'ui-inject-now'))).toEqual([
    { schemaVersion: 1, type: 'ui-inject-now', tabId },
  ]);
  await waitForReport(ui, tabId, (report) => report.coverageState === 'late-start');
  const lateTitle = await ui.evaluate(() => chrome.i18n.getMessage('coverage_late_start_title'));
  await expect(ui.locator('#coverage-title')).toHaveText(lateTitle);
  await expect(ui.locator('[data-scope-activation]')).toHaveCount(0);
  await expect(ui.locator('details.section')).not.toHaveAttribute('open');
  await expect(ui.locator('.notice .button--primary')).toHaveCount(0);
  expect((await sw.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
});
