// P08 / F085 / F052 / spec VI I5: DOM accessibility and emulated sidepanel reflow.
import type { Page } from '@playwright/test';
import { test, expect } from '../harness';
import { fixturePage, messages } from './fixture';

async function namedControls(page: Page) {
  const controls = page.locator('button:visible, input:visible, select:visible, textarea:visible, a[href]:visible, summary:visible, [role=tab]:visible');
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) await expect(control).toHaveAccessibleName(/\S/);
}

for (const width of [160, 180, 200]) for (const zoom of [1, 2]) {
  test(`P08: sidepanel ${width} CSS px, zoom ${zoom * 100}%`, async ({ ext }) => {
    const page = await fixturePage(ext, 'partial', 'sidepanel', width * zoom);
    await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, zoom);
    for (const tab of ['overview', 'techniques', 'sources', 'limits']) {
      await page.locator('#panel-tab-' + tab).click();
      await namedControls(page);
      const overflow = await page.evaluate(() => ({
        root: document.documentElement.scrollWidth > innerWidth,
        elements: [...document.querySelectorAll<HTMLElement>('main *')].filter((el) => el.checkVisibility() && !el.closest('.sr-only')).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        }).map((el) => el.outerHTML.slice(0, 180)),
      }));
      expect(overflow).toEqual({ root: false, elements: [] });
    }
  });
}

test('P08: forced colors preserve boundaries and keyboard focus; reduced motion disables effects', async ({ ext }) => {
  const page = await fixturePage(ext, 'active', 'sidepanel', 200);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.locator('#panel-search').focus();
  await page.keyboard.press('Tab');
  const focus = await page.locator(':focus').evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor, background: style.backgroundColor };
  });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe('none');
  expect(focus.color).not.toBe(focus.background);
  for (const control of await page.locator('#panel-search, .button:visible, .state:visible, .card:visible, .pill:visible').all()) {
    const style = await control.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: parseFloat(s.borderTopWidth), color: s.borderTopColor, background: s.backgroundColor };
    });
    expect(style.width).toBeGreaterThanOrEqual(1);
    expect(style.color).not.toBe(style.background);
  }
  expect(await page.locator('main *').evaluateAll((els) => els.every((el) => {
    const s = getComputedStyle(el);
    return s.animationName === 'none' && s.transitionDuration === '0s' && s.scrollBehavior === 'auto';
  }))).toBe(true);
});

test('P08: polite search announces latest result at most once per 2 s and cancels stale feedback', async ({ ext }) => {
  const page = await fixturePage(ext, 'active', 'sidepanel');
  await page.locator('#panel-tab-techniques').click();
  const search = page.locator('#panel-search');
  const region = page.locator('#panel-search-feedback');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveAttribute('aria-atomic', 'true');
  await expect(search).toHaveAttribute('aria-describedby', 'panel-search-feedback');
  await page.evaluate(() => {
    const region = document.querySelector('#panel-search-feedback')!;
    const updates: { at: number; text: string }[] = [];
    Object.assign(window, { p08SearchUpdates: updates });
    new MutationObserver(() => { if (region.textContent) updates.push({ at: Date.now(), text: region.textContent }); }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await search.fill('canvas');
  await expect(region).toContainText('1');
  await search.fill('missing');
  await page.waitForTimeout(600);
  await expect(region).toContainText('canvas');
  await search.fill('latest-missing');
  await expect(region).toContainText('latest-missing');
  await expect(region).toContainText(messages['search_empty']!.message);
  await expect(search).toBeFocused();
  const updates = await page.evaluate(() => (window as unknown as { p08SearchUpdates: { at: number; text: string }[] }).p08SearchUpdates);
  expect(updates).toHaveLength(2);
  expect(updates[1]!.at - updates[0]!.at).toBeGreaterThanOrEqual(2000);
  await search.fill('cancel-pending');
  await page.locator('#panel-tab-limits').click();
  await expect(region).toBeEmpty();
  await page.waitForTimeout(2100);
  await expect(region).toBeEmpty();
});

for (const surface of ['popup', 'sidepanel']) test(`P08: named ${surface} controls and export focus restoration`, async ({ ext }) => {
  const page = await fixturePage(ext, 'active', surface);
  await namedControls(page);
  const button = page.getByRole('button', { name: messages['action_export']!.message, exact: true });
  for (const close of ['cancel', 'escape']) {
    await button.focus();
    await button.press('Enter');
    await expect(page.locator('dialog')).toBeVisible();
    await expect(page.locator('dialog')).toHaveAccessibleName(messages['export_preview_title']!.message);
    await namedControls(page);
    if (close === 'escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: messages['action_cancel']!.message, exact: true }).click();
    await expect(page.locator('dialog')).not.toBeVisible();
    await expect(button).toBeFocused();
  }
});
