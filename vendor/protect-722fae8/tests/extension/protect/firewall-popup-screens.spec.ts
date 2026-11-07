// ADR-020 §D, §11 (S09, E21-09 case 2/3): the firewall card of the shipped popup (dist/test popup.html, Preact and
// protect.css) with fixed SW replies (ui-fixture.ts). States sent, stopped, unknown, multi, evidence-open,
// resolved-blocked, resolved-allowed, resolved-error, warn-only, snoozed × light / dark × 360 / 400 px:
// no horizontal overflow, no text below 12 px, accessible names, no green, no forbidden wording, «остановлен» in the
// card only for stopped (and the outcome «будут остановлены» only after an applied block), the decision buttons in
// the first screen of a 360 × 600 popup. PNGs go to test-results/protect-firewall/ (not the repository).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, repoRoot, launch, type ExtensionSession } from '../harness';
import { FW_SCREENS, fwScenario } from '../../../packages/ui/test/protect-firewall-support';
import type { FwScreen } from '../../../packages/ui/test/protect-firewall-support';
import { cardStateText, forbiddenPhrases, fwFixturePage, text } from './ui-fixture';

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

const DECIDE_SCREENS: ReadonlySet<FwScreen> = new Set(['sent', 'stopped', 'unknown', 'multi', 'evidence-open']);

test('S09: firewall card states × themes × widths', async ({ ext }) => {
  test.setTimeout(300_000);
  // Outside Playwright's outputDir (test-results/extension is emptied at every run); test-results/ is not in git.
  const directory = path.join(repoRoot, 'test-results/protect-firewall');
  mkdirSync(directory, { recursive: true });
  const forbidden = forbiddenPhrases();
  expect(forbidden.length).toBeGreaterThanOrEqual(20);
  const shots: Array<{ file: string; sha256: string; screen: string; theme: string; width: number }> = [];
  for (const screen of FW_SCREENS) for (const theme of ['light', 'dark'] as const) for (const width of [360, 400]) {
    const s = fwScenario(screen);
    const page = await fwFixturePage(ext, 'popup', { state: s.state, reports: [s.report], ...(s.decide === null ? {} : { decide: s.decide }) }, { width, height: 600 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const label = screen + '/' + theme + '/' + width;
    if (screen === 'snoozed') await expect(page.locator('[data-fw-snoozed]'), label).toBeVisible();
    else await expect(page.locator('[data-fw-card]'), label).toBeVisible();
    if (screen === 'evidence-open') await page.locator('.fw-evidence summary').click();

    // First screen of a 360 × 600 popup: both decision buttons visible without scrolling.
    if (DECIDE_SCREENS.has(screen)) {
      const boxes = await page.locator('.fw-action').evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      }));
      expect(boxes, label).toHaveLength(2);
      for (const b of boxes) {
        expect(b.top, label).toBeGreaterThanOrEqual(0);
        expect(b.bottom, label).toBeLessThanOrEqual(600);
        expect(b.height, label).toBeGreaterThanOrEqual(40);
      }
    }

    // Truthful card text (footer excluded: its counter is a lower bound, not a request state).
    const cardText = await cardStateText(page);
    if (screen !== 'snoozed' && !screen.startsWith('resolved')) {
      expect(cardText.includes('остановлен'), label).toBe(screen === 'stopped' || screen === 'multi');
      if (screen === 'unknown') expect(cardText, label).not.toContain('уже отправлен');
    }

    if (s.click !== null) {
      await page.locator('[data-fw-action=' + s.click + ']').click();
      await expect(page.locator('[data-fw-resolved]'), label).toBeVisible();
      await expect(page.locator('#fw-resolved-title'), label).toBeFocused();
      const resolved = (await page.locator('[data-fw-resolved]').innerText()).toLowerCase();
      if (screen === 'resolved-blocked') expect(resolved, label).toContain(text('fw_resolved_blocked_title').toLowerCase());
      if (screen === 'resolved-allowed') expect(resolved, label).toContain(text('fw_resolved_allowed_title').toLowerCase());
      if (screen === 'resolved-error') {
        expect(resolved, label).not.toContain('будут остановлены');
        await expect(page.locator('.fw-resolved__state'), label).toHaveClass(/state--error/);
      }
    }

    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    });
    const audit = await page.evaluate(() => {
      const visible = [...document.querySelectorAll<HTMLElement>('main *')].filter((el) => el.checkVisibility() && !el.closest('.sr-only'));
      const small = visible.filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.outerHTML.slice(0, 120));
      const green = visible.filter((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor, style.borderTopColor].some((color) => {
          const [r = 0, g = 0, b = 0, a = 1] = color.match(/[\d.]+/g)?.map(Number) ?? [];
          return a > 0 && g > r + 20 && g > b + 20;
        });
      }).map((el) => el.className);
      const fw = document.querySelector<HTMLElement>('[data-fw-root]');
      return { overflow: document.documentElement.scrollWidth > innerWidth, small, green, fwText: (fw?.innerText ?? '').toLowerCase() };
    });
    expect(audit.overflow, label).toBe(false);
    expect(audit.small, label).toEqual([]);
    expect(audit.green, label).toEqual([]);
    for (const phrase of forbidden) expect(audit.fwText, label + ' «' + phrase + '»').not.toContain(phrase);
    for (const control of await page.locator('[data-fw-root] button:visible, [data-fw-root] input:visible, [data-fw-root] summary:visible').all()) {
      await expect(control, label).toHaveAccessibleName(/\S/);
    }
    // The first screen as the user sees it (decision row pinned), then the whole page with the row in its place.
    const first = `fw-${screen}-${theme}-${width}-first.png`;
    const firstPng = await page.screenshot({ path: path.join(directory, first) });
    shots.push({ file: first, sha256: createHash('sha256').update(firstPng).digest('hex'), screen, theme, width });
    await page.addStyleTag({ content: '.fw-decision { position: static !important; }' });
    const file = `fw-${screen}-${theme}-${width}.png`;
    const png = await page.screenshot({ path: path.join(directory, file), fullPage: true });
    shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), screen, theme, width });
    await page.close();
  }
  expect(shots).toHaveLength(FW_SCREENS.length * 8);
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ requirement: 'S09 / E21-09', capturedAt: new Date().toISOString(), browser: ext.context.browser()?.version() ?? null, shots }, null, 2) + '\n');
});
