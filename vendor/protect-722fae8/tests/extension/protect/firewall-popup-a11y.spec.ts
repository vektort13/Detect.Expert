// ADR-020 §D (S09, E21-09): accessibility of the firewall card in the shipped popup (dist/test, fixed SW replies):
// Tab order through the card, focus on the outcome heading after a decision (and back on the card after undo), the
// live region announces at most once per 2 s while the pending count changes every poll, forced-colors mode keeps
// visible boundaries, zoom 200 % keeps everything reachable without horizontal scroll. Browser zoom 200 % of the
// 360 CSS px popup: Chrome grows the window to 720 × 600 device px (the popup maximum is 800 × 600), so the CSS
// viewport is 360 × 300 — emulated as such (popup.css keeps the page 360–400 CSS px wide).

import { test as base, expect, launch, type ExtensionSession } from '../harness';
import { FW_MULTI, FW_PROMPT_ID, fwProjection, fwReceiver, fwScenario, fwState } from '../../../packages/ui/test/protect-firewall-support';
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

test('S09 a11y: Tab order, focus on the outcome and back after undo', async ({ ext }) => {
  const s = fwScenario('sent');
  const page = await fwFixturePage(ext, 'popup', { state: s.state, reports: [s.report], decide: { applied: [{ receiver: s.report.firewall.receivers[0]!.receiver, ruleApplied: true }], undoId: 'fedcba9876543210' } });
  await expect(page.locator('[data-fw-card]')).toBeVisible();
  await page.locator('#fw-card-title').focus();
  const order: string[] = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null) return '';
      if (el.tagName === 'SUMMARY') return 'summary';
      if (el instanceof HTMLInputElement && el.type === 'radio') return 'radio:' + el.value;
      return el.getAttribute('data-fw-action') ?? el.textContent?.trim() ?? el.tagName;
    }));
  }
  // Radios form one Tab stop (the checked one).
  expect(order.slice(0, 6)).toEqual(['summary', 'radio:site', 'block', 'allow', text('protect_snooze'), text('fw_action_settings')]);
  await page.locator('[data-fw-action=block]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#fw-resolved-title')).toBeFocused();
  await page.getByRole('button', { name: text('fw_action_undo') }).click();
  await expect(page.locator('#fw-card-title')).toBeFocused();
  expect(await fwRequests(page, 'ui-protect-undo')).toHaveLength(1);
  // Arrow keys move inside the scope group without sending anything.
  await page.locator('.fw-scope input[value=site]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fw-scope input[value=everywhere]')).toBeChecked();
  expect(await fwRequests(page, 'ui-protect-decide')).toHaveLength(1);
  await page.close();
});

test('S09 a11y: the live region announces at most once per 2 s', async ({ ext }) => {
  test.setTimeout(60_000);
  // Every poll (1 s) answers a different number of pending receivers.
  const reports = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1].map((n) => fwProjection({ receivers: FW_MULTI.slice(0, n).map((r) => fwReceiver(r)) }));
  const page = await fwFixturePage(ext, 'popup', { state: fwState(), reports });
  await expect(page.locator('[data-fw-card]')).toBeVisible();
  await page.evaluate(() => {
    const region = document.querySelector('[data-fw-live]')!;
    const changes: Array<{ at: number; text: string }> = [];
    (window as unknown as { __liveChanges: typeof changes }).__liveChanges = changes;
    new MutationObserver(() => changes.push({ at: performance.now(), text: region.textContent ?? '' })).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(8_000);
  const changes = await page.evaluate(() => (window as unknown as { __liveChanges: Array<{ at: number; text: string }> }).__liveChanges.filter((c) => c.text !== ''));
  expect(changes.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < changes.length; i++) expect(changes[i]!.at - changes[i - 1]!.at).toBeGreaterThanOrEqual(1_900);
  for (const c of changes) expect(c.text).toMatch(/^Фаервол: адресов ждут решения — [1-3]$/);
  await page.close();
});

test('S09 a11y: forced colors and zoom 200 %', async ({ ext }) => {
  const s = fwScenario('multi');
  const page = await fwFixturePage(ext, 'popup', { state: s.state, reports: [s.report] });
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('[data-fw-card]')).toBeVisible();
  const forced = await page.evaluate(() => {
    const border = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      const st = getComputedStyle(el);
      return { width: parseFloat(st.borderTopWidth), color: st.borderTopColor };
    };
    return { card: border('.fw-card'), option: border('.fw-scope__option'), button: border('.fw-action'), forced: matchMedia('(forced-colors: active)').matches };
  });
  expect(forced.forced).toBe(true);
  for (const b of [forced.card, forced.option, forced.button]) {
    expect(b.width).toBeGreaterThan(0);
    expect(b.color).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  }
  await page.emulateMedia({ forcedColors: 'none' });

  // Zoom 200 % of a 360 × 600 popup = a 360 × 300 CSS px viewport (see the header).
  await page.setViewportSize({ width: 360, height: 300 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const zoom = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    sticky: getComputedStyle(document.querySelector('.fw-decision')!).position,
  }));
  expect(zoom.overflow).toBe(false);
  expect(zoom.sticky).toBe('static');
  for (const name of ['block', 'allow']) {
    const button = page.locator('[data-fw-action=' + name + ']');
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    const box = await button.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(360);
  }
  // Every control is reachable with the keyboard and named.
  for (const control of await page.locator('[data-fw-root] button, [data-fw-root] input, [data-fw-root] summary').all()) await expect(control).toHaveAccessibleName(/\S/);
  await page.locator('[data-fw-action=block]').click();
  await expect(page.locator('#fw-resolved-title')).toBeFocused();
  const [request] = await fwRequests(page, 'ui-protect-decide');
  expect(request).toMatchObject({ promptId: FW_PROMPT_ID, receivers: [...FW_MULTI], scope: 'site', action: 'block' });
  await page.close();
});
