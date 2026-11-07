// P08 / E13-01 / REQ-006/014: browser-rendered UI evidence with fixed, mocked report projections.
// No extension is installed here; real service-worker timing and branded-browser acceptance are separate.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COVERAGE_STATES } from '@detect-expert/contracts';
import type { CoverageState, ReportProjection } from '@detect-expert/contracts';
import { finding, report, technique } from './fixtures';
import type {} from './browser-harness';

// P08: unit render artifacts must not overwrite the built-extension acceptance PNGs.
const screenshotDir = resolve('test-results/ui-presentation');
const messages = JSON.parse(readFileSync('apps/extension/_locales/ru/messages.json', 'utf8')) as Parameters<Window['uiAudit']['mount']>[1];
const sharedCss = readFileSync('packages/ui/src/styles/ui.css', 'utf8');
const panelCss = readFileSync('apps/extension/entrypoints/sidepanel/sidepanel.css', 'utf8');
const evidence: Array<{ file: string; sha256: string; bytes: number; width: number; state: string; theme: string }> = [];
let browser: Browser;
let page: Page;
let script: string;

beforeAll(async () => {
  script = (await build({ entryPoints: ['packages/ui/test/browser-harness.ts'], bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact' })).outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  mkdirSync(screenshotDir, { recursive: true });
}, 30_000);
beforeEach(async () => {
  page = await browser.newPage({ locale: 'ru-RU', timezoneId: 'UTC' });
  await page.addScriptTag({ content: script });
  await page.addStyleTag({ content: sharedCss + '\n' + panelCss });
});
afterEach(async () => { await page.close(); });
afterAll(async () => {
  writeFileSync(resolve(screenshotDir, 'manifest.json'), JSON.stringify({
    requirement: 'P08 / E13-01', capturedAt: new Date().toISOString(), browser: browser.version(),
    source: 'Preact product components and shipped CSS; mocked privileged channel; no service worker or browser grant claim',
    locale: 'ru', timezone: 'UTC', screenshots: evidence,
  }, null, 2) + '\n');
  await browser.close();
});

function stateReport(state: CoverageState): ReportProjection {
  return report({
    scopeMode: 'site', coverageState: state,
    coverageFlags: state === 'degraded' ? ['channel-gap', 'truncated'] : state === 'partial' ? ['worker-not-observed', 'network-limited'] : state === 'no-access' ? ['no-host-permission'] : state === 'late-start' ? ['late-start'] : [],
    techniques: [technique({ techniqueId: 'DET-002' })],
    findings: [finding({ techniqueId: 'DET-002', findingId: 'canvas-observation', interpretation: 'api-use', interpretationConfidence: 'unassessed' })],
  });
}

async function mount(surface: 'popup' | 'sidepanel', state: string) {
  const rep = COVERAGE_STATES.includes(state as CoverageState) ? stateReport(state as CoverageState) : state === 'empty' ? report({ scopeMode: 'site' }) : null;
  await page.evaluate(({ surface, state, rep, messages }) => {
    window.uiAudit.report = rep;
    window.uiAudit.scope = { scopeMode: state === 'off' ? 'off' : 'site', hosts: state === 'off' ? [] : ['example.com'], grantedAllSites: false, managed: false };
    window.uiAudit.tabUrl = state === 'restricted' ? 'chrome://settings/' : 'https://example.com/';
    window.uiAudit.delay = state === 'loading' ? 60_000 : 0;
    window.uiAudit.mount(surface, messages);
  }, { surface, state, rep, messages });
  if (state === 'loading') await page.locator('main').waitFor();
  else await page.waitForFunction(() => window.uiAudit.requests.some((request) => request.type === 'ui-get-report') && !document.querySelector('.pill')?.textContent?.includes('Загрузка'));
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function assertPresentation(width: number) {
  const result = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll<HTMLElement>('main *')).filter((element) => element.getClientRects().length > 0);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      minimumFont: Math.min(...visible.filter((element) => element.textContent?.trim()).map((element) => Number.parseFloat(getComputedStyle(element).fontSize))),
      text: document.querySelector('main')?.textContent ?? '',
      missingNames: visible.filter((element) => element.matches('button, input, select, textarea, summary, a[href]')).filter((element) => {
        const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join('');
        const labels = element instanceof HTMLInputElement ? Array.from(element.labels ?? [], (label) => label.textContent).join('') : '';
        return !(element.getAttribute('aria-label') || labelledBy || labels || element.textContent)?.trim();
      }).map((element) => ({ tag: element.tagName, id: element.id, role: element.getAttribute('role') })),
    };
  });
  expect(result.scrollWidth).toBeLessThanOrEqual(width);
  expect(result.minimumFont).toBeGreaterThanOrEqual(12);
  expect(result.missingNames).toEqual([]);
  expect(result.text).not.toMatch(/сайт безопасен|сайт чист|утечка доказана|невидимо для сайта|100\s*%/i);
}

describe('P08 popup state artifacts', () => {
  for (const state of [...COVERAGE_STATES, 'restricted', 'off', 'loading', 'empty']) {
    for (const theme of ['light', 'dark'] as const) {
      for (const width of [360, 400]) it(state + ' / ' + theme + ' / ' + String(width), async () => {
        await page.setViewportSize({ width, height: 600 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await mount('popup', state);
        await assertPresentation(width);
        const file = state + '-' + theme + '-' + String(width) + '.png';
        const bytes = await page.screenshot({ path: resolve(screenshotDir, file), fullPage: true, animations: 'disabled' });
        evidence.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, width, state, theme });
      });
    }
  }
});

describe('P08 sidepanel accessibility', () => {
  for (const effectiveWidth of [160, 180, 200]) for (const zoom of [1, 2]) it(String(effectiveWidth) + ' CSS px, zoom ' + String(zoom), async () => {
    const width = effectiveWidth * zoom;
    await page.setViewportSize({ width, height: 900 });
    await page.addStyleTag({ content: 'body { zoom: ' + String(zoom) + '; }' });
    await mount('sidepanel', 'partial');
    for (const tab of ['overview', 'techniques', 'sources', 'limits']) {
      await page.locator('#panel-tab-' + tab).click();
      await assertPresentation(width);
    }
  });

  it('retains focus and control boundaries in forced colors and reduced motion', async () => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await mount('sidepanel', 'active');
    await page.locator('#panel-search').focus();
    const styles = await page.locator('#panel-search').evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, background: style.backgroundColor, outline: style.outlineStyle, outlineWidth: style.outlineWidth, animation: style.animationName, transition: style.transitionDuration };
    });
    expect(styles.border).not.toBe(styles.background);
    expect(styles.outline).not.toBe('none');
    expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(styles.animation).toBe('none');
    expect(styles.transition).toBe('0s');
    await assertPresentation(360);
  });

  it('returns keyboard focus to export after cancelling its native dialog', async () => {
    await mount('sidepanel', 'active');
    const button = page.getByRole('button', { name: messages['action_export']!.message, exact: true });
    await button.focus();
    await button.press('Enter');
    await page.waitForFunction(() => document.querySelector('dialog')?.open);
    expect((await page.getByRole('dialog').ariaSnapshot()).length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog')?.open);
    expect(await button.evaluate((element) => document.activeElement === element)).toBe(true);
  });
});
