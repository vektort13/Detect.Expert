// ADR-042: rendered layout and accessible states on the shared shipped surfaces.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..'), extension = join(root, 'dist/chrome');
const run = join(root, '.tmp/glass-layout-' + Date.now()); mkdirSync(run, { recursive: true });
const evidence = { checks: [], errors: [], screens: [], layouts: [] };
const context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
  viewport: { width: 380, height: 800 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
context.on('page', page => page.on('pageerror', error => evidence.errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const page = await context.newPage();
  const open = async surface => {
    await page.goto('chrome-extension://' + id + '/' + surface + '.html'); await page.locator('.language-picker__trigger').waitFor();
    if (surface === 'popup' || surface === 'sidepanel') await page.locator('[data-observation-master][aria-checked="true"]:not(:disabled)').waitFor();
  };
  const shot = async name => { await page.screenshot({ path: join(run, name + '.png'), fullPage: false }); evidence.screens.push(name + '.png'); };
  const measure = async (surface, locale, width, theme) => {
    const value = await page.evaluate(() => {
      const rect = selector => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, logo: rect('.inspector-brand__logo'), master: rect('[data-observation-master]'),
        mode: rect('.inspector-mode-tabs .tabs__tab'), blocking: rect('.blocking-launcher__open'), blockingToggle: rect('.blocking-launcher .blocking-master'),
        clippedLabels: [...document.querySelectorAll('.identification-tab__label, .blocking-chip__label, .blocking-rule__partial')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent),
        cards: [...document.querySelectorAll('.identification-tab')].map(node => ({ radius: getComputedStyle(node).borderRadius, image: getComputedStyle(node).backgroundImage, shadow: getComputedStyle(node).boxShadow })) };
    });
    assert.ok(value.scroll <= value.viewport + 1, surface + ' ' + locale + ' ' + width + ' no horizontal overflow: ' + JSON.stringify(value));
    assert.deepEqual(value.clippedLabels, [], surface + ' labels fit');
    if (value.master) {
      assert.ok(value.master.y >= value.logo.y + value.logo.height, 'master sits below logo');
      assert.ok(Math.abs(value.master.x + value.master.width / 2 - value.logo.x - value.logo.width / 2) < 2);
    }
    if (value.mode && value.blocking) {
      assert.equal(value.mode.height, value.blocking.height); assert.equal(value.mode.height, value.blockingToggle.height);
    }
    evidence.layouts.push({ surface, locale, width, theme, ...value });
  };
  for (const surface of ['popup', 'sidepanel', 'options', 'protection']) {
    await open(surface);
    for (const locale of ['ru', 'en', 'de', 'ar', 'te']) {
      await page.evaluate(language => chrome.storage.local.set({ 'ui-language-v1': language }), locale);
      await page.waitForFunction(language => document.documentElement.lang.startsWith(language), locale);
      for (const width of surface === 'popup' ? [380] : [320, 620]) {
        await page.setViewportSize({ width, height: 850 }); await page.waitForTimeout(80);
        await measure(surface, locale, width, 'light');
        if (locale === 'ru' && (width === 380 || width === 620)) await shot(surface + '-ru-light');
      }
    }
    await page.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    await page.setViewportSize({ width: surface === 'popup' ? 380 : 620, height: 850 });
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(220); await measure(surface, 'ru', surface === 'popup' ? 380 : 620, 'dark');
    await shot(surface + '-ru-dark');
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'active' });
    if (surface === 'popup' || surface === 'sidepanel') {
      const master = page.locator('[data-observation-master]'); await master.focus();
      const style = await master.evaluate(node => { const s = getComputedStyle(node), thumb = getComputedStyle(node.firstElementChild); return { outline: s.outlineStyle, shadow: s.boxShadow, transition: thumb.transitionDuration }; });
      assert.notEqual(style.outline, 'none'); assert.equal(style.shadow, 'none'); assert.equal(style.transition, '0s');
    }
    if (surface === 'protection') {
      // ADR-046: the selected category chip keeps a visible focus outline in forced colors.
      const chip = page.locator('[data-protection-filter][aria-checked="true"]'); await chip.focus();
      const outline = await chip.evaluate(node => getComputedStyle(node).outlineStyle);
      assert.notEqual(outline, 'none', 'selected chip focus outline in forced colors');
      evidence.chipFocusOutline = outline;
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference', forcedColors: 'none' });
  }
  await open('popup');
  await page.setViewportSize({ width: 380, height: 850 });
  await page.locator('.language-picker__trigger').click(); await shot('language-menu');
  assert.equal(await page.locator('.language-picker__menu button').count(), 21);
  assert.deepEqual(evidence.errors, []); evidence.status = 'PASS';
  evidence.checks.push('four surfaces', 'five languages including RTL and Telugu', 'narrow and wide layouts', 'dark mode', 'forced colors focus', 'chip and partial labels unclipped', 'reduced motion', 'equal mode/blocking heights', 'master centered below logo');
  console.log('PASS glass layout: ' + evidence.layouts.length + ' rendered layouts; ' + evidence.checks.join(', '));
} finally {
  writeFileSync(join(run, 'layout.json'), JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(join(root, '.tmp/glass-layout-latest.json'), JSON.stringify({ run, ...evidence }, null, 2) + '\n');
  await context.close();
}
