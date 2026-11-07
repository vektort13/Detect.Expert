// P08 / REQ-006 / REQ-007 / E13-01: reproducible state evidence from shipped extension pages.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, repoRoot, launch, type ExtensionSession } from '../harness';
import { fixturePage, states, messages } from './fixture';

const test = base.extend<{ ext: ExtensionSession }>({
  ext: async ({}, use) => {
    const session = await launch({ locale: 'ru-RU', timezoneId: 'UTC' });
    try { await use(session); } finally { await session.close(); }
  },
});

test('P08: all popup states, themes and widths produce PNG evidence', async ({ ext }) => {
  test.setTimeout(120_000);
  const directory = path.join(repoRoot, 'tests/extension/popup/__screenshots__');
  mkdirSync(directory, { recursive: true });
  const section = readFileSync(path.join(repoRoot, 'docs/ui-copy.md'), 'utf8').split('## 8.')[1]!.split('## 9.')[0]!;
  const forbidden = [...section.matchAll(/«([^»]+)»/g)].map((match) => match[1]!.toLowerCase());
  expect(forbidden.length).toBeGreaterThanOrEqual(18);
  const screenshots = [];
  for (const state of states) for (const theme of ['light', 'dark'] as const) for (const width of [360, 400]) {
    const page = await fixturePage(ext, state, 'popup', width);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    expect(await page.evaluate(() => ({ locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }))).toEqual({ locale: 'ru-RU', timezone: 'UTC' });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
    const audit = await page.evaluate(() => {
      const visible = [...document.querySelectorAll<HTMLElement>('main *')].filter((el) => el.checkVisibility() && !el.closest('.sr-only'));
      const small = visible.filter((el) => {
        const hasText = el.matches('input, textarea, select') || [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        return (hasText && parseFloat(getComputedStyle(el).fontSize) < 12) ||
          (el.matches('input[placeholder], textarea[placeholder]') && parseFloat(getComputedStyle(el, '::placeholder').fontSize) < 12);
      }).map((el) => el.outerHTML);
      const green = visible.filter((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor, style.borderTopColor].some((color) => {
          const rgb = color.match(/[\d.]+/g)?.map(Number) ?? [];
          const [r = 0, g = 0, b = 0, a = 1] = rgb;
          return a > 0 && g > r + 20 && g > b + 20;
        });
      }).map((el) => el.className);
      return { overflow: document.documentElement.scrollWidth > innerWidth, small, green, text: document.querySelector<HTMLElement>('main')!.innerText.toLowerCase() };
    });
    expect(audit.overflow, state + '/' + theme + '/' + width).toBe(false);
    expect(audit.small).toEqual([]);
    expect(audit.green).toEqual([]);
    for (const control of await page.locator('button:visible, input:visible, select:visible, textarea:visible, a[href]:visible, summary:visible').all()) {
      await expect(control).toHaveAccessibleName(/\S/);
    }
    // These fixtures contain no candidate/stale claims; even the context-sensitive words must be absent.
    for (const phrase of forbidden) expect(audit.text).not.toContain(phrase);
    if (state === 'empty') {
      await expect(page.locator('.empty__title')).toHaveText(messages['empty_no_findings']!.message);
      await expect(page.locator('#coverage')).toBeVisible();
      await expect(page.locator('article')).toHaveCount(0);
    }
    // P11: visual evidence also checks the actual DOM order and disclosure defaults.
    if (state === 'off' || state === 'no-access') {
      await expect(page.locator('[data-scope-activation]')).toBeVisible();
      expect(await page.locator('[data-scope-activation]').evaluate((element) => element.previousElementSibling?.id)).toBe('coverage');
      await expect(page.locator('form.scope input[type=radio]')).toHaveCount(3);
      if (state === 'no-access') {
        expect(await page.locator('form.scope').evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[aria-labelledby="findings-title"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      }
    } else if (state === 'active') {
      await expect(page.locator('details.section')).not.toHaveAttribute('open');
      expect(await page.locator('[aria-labelledby="findings-title"]').evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('details.section')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    }
    const file = `${state}-${theme}-${width}.png`;
    const png = await page.screenshot({ path: path.join(directory, file), fullPage: true });
    screenshots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length, width, state, theme });
    await page.close();
  }
  expect(screenshots).toHaveLength(44);
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ requirement: 'P08 / E13-01', capturedAt: new Date().toISOString(), browser: ext.context.browser()!.version(), source: 'Собранные dist/test popup.html, Preact и CSS; фиксированные ответы канала SW через Playwright init script, без изменения сборки', locale: 'ru', timezone: 'UTC', screenshots }, null, 2) + '\n');
});
