// Actual Chromium DOM/focus/timer checks, with a mocked privileged channel and no host grants.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { report, technique, finding, vendor } from './fixtures';
import type { UiSurface } from '../src/view-models/scope';
import type {} from './browser-harness';

const table = (locale = 'en') => JSON.parse(readFileSync(resolve('apps/extension/_locales', locale, 'messages.json'), 'utf8')) as Parameters<Window['uiAudit']['mount']>[1];
let browser: Browser;
let page: Page;
let script: string;
beforeAll(async () => {
  script = (await build({ entryPoints: ['packages/ui/test/browser-harness.ts'], bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact' })).outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
}, 30_000);
beforeEach(async () => { page = await browser.newPage(); await page.addScriptTag({ content: script }); });
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser?.close(); });

async function mount(surface: UiSurface, options: { delay?: number; probe?: boolean; locale?: string } = {}) {
  await page.evaluate(({ surface, rep, messages, options }) => {
    window.uiAudit.report = rep;
    window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false };
    window.uiAudit.delay = options.delay ?? 0;
    window.uiAudit.mount(surface, messages, options.probe);
  }, { surface, rep: report({ coverageState: 'paused', techniques: [technique({ techniqueId: 'DET-002' })], findings: [finding({ findingId: 'same', techniqueId: 'DET-002' })] }), messages: table(options.locale), options });
}
async function loaded() { await page.waitForFunction(() => window.uiAudit.requests.some((r) => r.type === 'ui-get-report')); }
async function focused(id: string) { return page.evaluate((id) => document.activeElement?.id === id, id); }

describe('audit accessibility regressions', () => {
  for (const locale of ['ru', 'en']) it('P11 ' + locale + ': off hint, unavailable host and explicit grant reload action', async () => {
    const messages = table(locale);
    await page.evaluate((messages) => {
      window.uiAudit.tabUrl = '';
      window.uiAudit.mount('popup', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-scope-activation]') !== null);
    expect(await page.locator('.host').textContent()).toBe(messages['host_access_needed']!.message);
    expect(await page.locator('#coverage').textContent()).toContain(messages['scope_start_hint']!.message);
    expect(await page.locator('#popup-scope-site').isDisabled()).toBe(true);
    expect(await page.locator('#popup-scope-site + label').textContent()).toContain(messages['scope_site_host_unknown']!.message);
    await page.locator('#popup-scope-all-sites').check();
    await page.locator('form.scope button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('.notice [role=status]')?.textContent?.includes('Доступ выдан') || document.querySelector('.notice [role=status]')?.textContent?.includes('Access granted'));
    expect(await page.locator('.notice [role=status]').textContent()).toBe(messages['scope_permission_granted_reload']!.message);
    expect(await page.evaluate(() => window.uiAudit.permissionRequests)).toEqual([['http://*/*', 'https://*/*']]);
    expect(await page.evaluate(() => window.uiAudit.reloads)).toEqual([]);
    await page.locator('.notice').getByRole('button', { name: messages['action_reload_short']!.message, exact: true }).click();
    expect(await page.evaluate(() => window.uiAudit.reloads)).toEqual([12]);
    expect(await page.locator('.notice').count()).toBe(0);
  });

  it('P11 a denied popup grant retains activation choices and offers no reload', async () => {
    await page.evaluate((messages) => {
      window.uiAudit.permission = false;
      window.uiAudit.mount('popup', messages);
    }, table());
    await page.locator('#popup-scope-all-sites').check();
    await page.locator('form.scope button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('not granted'));
    expect(await page.locator('[data-scope-activation]').count()).toBe(1);
    expect(await page.locator('.notice .button--primary').count()).toBe(0);
    expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-set-scope'))).toBe(false);
  });

  it('P11 popup displays an already available sanitized host without requiring a report', async () => {
    await page.evaluate((messages) => { window.uiAudit.mount('popup', messages); }, table());
    await page.waitForFunction(() => document.querySelector('.host')?.textContent === 'example.com');
    expect(await page.locator('#popup-scope-site').isEnabled()).toBe(true);
  });

  it('P11 active reports retain their redacted host instead of using the scope host', async () => {
    await page.evaluate(({ rep, messages }) => {
      window.uiAudit.report = rep;
      window.uiAudit.scope.scopeMode = 'site';
      window.uiAudit.mount('popup', messages);
    }, { rep: report({ host: null, coverageState: 'active' }), messages: table() });
    await page.waitForFunction((status) => document.querySelector('.pill')?.textContent === status, table()['status_active']!.message);
    expect(await page.locator('.host').textContent()).toBe(table()['host_unknown']!.message);
  });

  it('P08 throttles search feedback for two seconds and cancels pending results on clear', async () => {
    await mount('sidepanel');
    await page.locator('#panel-tab-techniques').click();
    const input = page.locator('#panel-search');
    const region = page.locator('#panel-search-feedback');
    await input.fill('canvas');
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent?.includes('canvas'));
    await input.fill('missing');
    await page.waitForTimeout(650);
    expect(await region.textContent()).toContain('canvas');
    await input.fill('latest');
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent?.includes('latest'));
    expect(await region.textContent()).toContain('Nothing matches');
    await input.fill('pending');
    await input.fill('');
    await page.waitForTimeout(2100);
    expect(await region.textContent()).toBe('');
    expect(await focused('panel-search')).toBe(true);
  }, 10_000);

  it('F052 debounces empty/count feedback in a persistent described region without moving focus', async () => {
    await mount('sidepanel');
    await page.locator('#panel-tab-techniques').click();
    expect(await page.locator('#panel-coverage').getAttribute('aria-labelledby')).toBe('panel-coverage-title');
    const input = page.locator('#panel-search');
    await input.fill('can');
    await page.waitForTimeout(200);
    expect(await page.locator('#panel-search-feedback').textContent()).toBe('');
    await input.fill('canvas');
    await page.waitForTimeout(200);
    expect(await page.locator('#panel-search-feedback').textContent()).toBe('');
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent?.includes('1'));
    expect(await focused('panel-search')).toBe(true);
    expect(await input.getAttribute('aria-describedby')).toBe('panel-search-feedback');
    await input.fill('zzzz');
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent?.includes('Nothing matches'));
    expect(await focused('panel-search')).toBe(true);
    await page.locator('#panel-tab-limits').click();
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent === '');
  });

  for (const surface of ['popup', 'sidepanel'] as const) it('F063 loading is honest on ' + surface, async () => {
    await mount(surface, { delay: 500 });
    expect(await page.locator('h2').first().textContent()).toContain(table()['statusLoading']!.message);
    expect(await page.locator('.pill').textContent()).toContain(table()['statusLoading']!.message);
    expect(await page.getByText('Observation is off', { exact: true }).count()).toBe(0);
    await page.waitForFunction(() => document.querySelector('.pill')?.textContent?.includes('paused'));
  });

  for (const surface of ['sidepanel', 'options'] as const) it('F053 prevents unsupported activeTab activation on ' + surface, async () => {
    await mount(surface);
    const prefix = surface === 'options' ? 'options' : 'panel';
    expect(await page.locator('#' + prefix + '-scope-active-tab').isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-inject-now' || r.type === 'ui-set-scope'))).toBe(false);
  });

  it('F053 guards the session API before sending or persisting unsupported activation', async () => {
    await mount('options', { probe: true });
    await page.waitForFunction(() => window.uiAudit.session?.loaded);
    await page.evaluate(() => window.uiAudit.session!.applyScope('active-tab', null));
    expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-inject-now' || r.type === 'ui-set-scope'))).toBe(false);
    expect(await page.locator('[role=status]').textContent()).toContain(table()['scope_active_tab_toolbar']?.message ?? 'scope_active_tab_toolbar');
  });

  it('F057 keeps the same live region and retains a permission refusal beyond six seconds', async () => {
    await mount('options');
    await loaded();
    await page.evaluate(() => { window.uiAudit.permission = false; document.querySelector('[role=status]')!.setAttribute('data-original', 'true'); });
    await page.locator('#options-scope-all-sites').check();
    await page.getByRole('button', { name: table()['action_apply']!.message, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('not granted'));
    await page.clock.install();
    await page.clock.fastForward(7000);
    expect(await page.locator('[role=status]').getAttribute('data-original')).toBe('true');
    expect(await page.locator('[role=status]').getAttribute('aria-atomic')).toBe('true');
    expect(await page.locator('[role=status]').textContent()).toContain('not granted');
    await page.getByRole('button', { name: table()['action_dismiss']!.message }).click();
    expect(await page.locator('[role=status]').textContent()).toBe('');
  });

  it('F058/F139 retains focus and ordinary action semantics through resume and clear', async () => {
    await mount('popup');
    await loaded();
    for (const key of ['action_resume', 'action_clear']) {
      const button = page.getByRole('button', { name: table()[key]!.message, exact: true });
      await button.evaluate((element) => { element.id = 'initiator'; });
      await button.focus();
      await page.evaluate(() => { window.uiAudit.delay = 50; });
      expect(await button.getAttribute('aria-pressed')).toBeNull();
      await button.press('Enter');
      await page.waitForFunction(() => document.getElementById('initiator')?.closest('[aria-busy]')?.getAttribute('aria-busy') === 'true');
      expect(await focused('initiator')).toBe(true);
      await page.waitForFunction(() => document.getElementById('initiator')?.closest('[aria-busy]')?.getAttribute('aria-busy') === 'false');
      expect(await focused('initiator')).toBe(true);
      await page.locator('#initiator').evaluate((element) => element.removeAttribute('id'));
    }
  });

  it('F058 retains focus after scope apply and session clear in options', async () => {
    await mount('options');
    await loaded();
    await page.locator('#options-scope-all-sites').check();
    for (const key of ['action_apply', 'options_clear_session']) {
      const button = page.getByRole('button', { name: table()[key]!.message, exact: true });
      await button.evaluate((element) => { element.id = 'initiator'; });
      await page.evaluate(() => { window.uiAudit.delay = 50; });
      await button.focus();
      await button.press('Enter');
      await page.waitForFunction(() => document.getElementById('initiator')?.getAttribute('aria-disabled') === 'true');
      expect(await focused('initiator')).toBe(true);
      await page.waitForFunction(() => document.getElementById('initiator')?.getAttribute('aria-disabled') === 'false');
      expect(await focused('initiator')).toBe(true);
      await button.evaluate((element) => element.removeAttribute('id'));
    }
  });

  it('F058 rejects same-tick reentrant actions before a render', async () => {
    await mount('popup', { probe: true });
    await page.waitForFunction(() => window.uiAudit.session?.loaded);
    await page.evaluate(async () => {
      window.uiAudit.delay = 20;
      await Promise.all([window.uiAudit.session!.resume(), window.uiAudit.session!.resume(), window.uiAudit.session!.clearSession()]);
    });
    expect(await page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-resume').length)).toBe(1);
    expect(await page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-clear-session').length)).toBe(0);
  });

  it('F140 selects and focuses Home/End destinations and moves arrows from there', async () => {
    await mount('sidepanel');
    await page.locator('#panel-tab-overview').focus();
    for (const [key, target] of [['End', 'limits'], ['ArrowLeft', 'sources'], ['Home', 'overview'], ['ArrowRight', 'techniques']] as const) {
      await page.keyboard.press(key);
      const id = 'panel-tab-' + target;
      expect(await focused(id)).toBe(true);
      expect(await page.locator('#' + id).getAttribute('aria-selected')).toBe('true');
      expect(await page.locator('#' + id).getAttribute('tabindex')).toBe('0');
    }
  });

  it('F177 gives every repeated card its own heading reference across panels', async () => {
    await mount('sidepanel');
    await loaded();
    await page.locator('#panel-tab-techniques').click();
    const verify = async () => page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id);
      return new Set(ids).size === ids.length && Array.from(document.querySelectorAll('article[aria-labelledby]')).every((node) => node.contains(document.getElementById(node.getAttribute('aria-labelledby')!)));
    });
    expect(await verify()).toBe(true);
    await page.locator('#panel-tab-overview').click();
    expect(await verify()).toBe(true);
    await page.evaluate((rep) => { window.uiAudit.report = rep; window.uiAudit.vendors(); }, report({ vendors: [vendor({ vendorId: 'same' })] }));
    expect(await page.locator('article').count()).toBe(2);
    expect(await verify()).toBe(true);
  });

  it('F054 host selection changes the exact preview and resets on reopen', async () => {
    await mount('popup');
    await loaded();
    await page.getByRole('button', { name: table()['action_export']!.message, exact: true }).click();
    const check = page.locator('dialog input[type=checkbox]');
    expect(await check.isChecked()).toBe(false);
    expect(JSON.parse(await page.locator('dialog pre').textContent() ?? '{}').report.host).toBeNull();
    await check.check();
    expect(JSON.parse(await page.locator('dialog pre').textContent() ?? '{}').report.host).toBe('example.com');
    await check.uncheck();
    expect(JSON.parse(await page.locator('dialog pre').textContent() ?? '{}').report.host).toBeNull();
    await page.getByRole('button', { name: table()['action_cancel']!.message, exact: true }).click();
    await page.getByRole('button', { name: table()['action_export']!.message, exact: true }).click();
    expect(await check.isChecked()).toBe(false);
  });

  it('F057 export refusal stays visible after the dialog closes', async () => {
    await mount('popup');
    await loaded();
    await page.getByRole('button', { name: table()['action_export']!.message, exact: true }).click();
    await page.evaluate(() => { window.uiAudit.report = { ...window.uiAudit.report!, documentKey: '12:0:new' }; });
    await page.getByRole('button', { name: table()['export_save']!.message, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog')?.open);
    expect(await page.locator('.notice [role=status]').textContent()).toContain(table()['export_document_changed']!.message);
  });

  for (const surface of ['popup', 'sidepanel'] as const) it('F058 moves focus to coverage when clear removes the report in ' + surface, async () => {
    await mount(surface);
    await loaded();
    await page.evaluate(() => { window.uiAudit.emptyAfterClear = true; });
    const button = page.getByRole('button', { name: table()['action_clear']!.message, exact: true });
    await button.focus();
    await button.press('Enter');
    await page.waitForFunction(() => document.activeElement?.classList.contains('state__title'));
    expect(await focused(surface === 'popup' ? 'coverage-title' : 'panel-coverage-title')).toBe(true);
  });

  it('F053 refuses known restricted targets before saving active-tab scope', async () => {
    await page.evaluate(() => { window.uiAudit.tabUrl = 'chrome://settings/'; });
    await mount('popup', { probe: true });
    await page.waitForFunction(() => window.uiAudit.session?.loaded);
    await page.evaluate(() => window.uiAudit.session!.applyScope('active-tab', null));
    expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-set-scope' || r.type === 'ui-inject-now'))).toBe(false);
  });

  it('F057 cancellation invalidates a pending export confirmation', async () => {
    await mount('popup', { probe: true });
    await page.waitForFunction(() => window.uiAudit.session?.loaded);
    await page.evaluate(() => window.uiAudit.session!.openExport());
    await page.waitForFunction(() => window.uiAudit.session?.preview !== null);
    const clicks = await page.evaluate(async () => {
      let clicks = 0;
      document.addEventListener('click', (event) => { if (event.target instanceof HTMLAnchorElement) { clicks++; event.preventDefault(); } });
      window.uiAudit.delay = 50;
      const pending = window.uiAudit.session!.confirmExport();
      window.uiAudit.session!.cancelExport();
      await pending;
      return clicks;
    });
    expect(clicks).toBe(0);
  });

  it('F059/F062 renders unavailable matching even with an empty report', async () => {
    await mount('popup');
    await loaded();
    expect(await page.locator('.counts__item').nth(1).textContent()).toContain(table()['counts_unavailable']!.message);
    expect(await page.getByText(table()['vendorsEmpty']!.message, { exact: true }).count()).toBe(0);
  });

  for (const locale of ['ru', 'en']) it('F061/F142/F144 renders conservative observation and interpretation in ' + locale, async () => {
    const rep = report({ techniques: [
      technique({ techniqueId: 'DET-001', count: 1, phases: ['attempted'] }),
      technique({ techniqueId: 'DET-003', count: 1 }),
    ], findings: [finding({ findingId: 'single', techniqueId: 'DET-001', interpretation: 'possible-fingerprinting', counterEvidenceCodes: ['high-volume-rendering'] })] });
    await page.evaluate(({ rep, messages }) => { window.uiAudit.report = rep; window.uiAudit.mount('popup', messages); }, { rep, messages: table(locale) });
    await loaded();
    await page.waitForFunction(() => document.querySelectorAll('article').length === 2);
    const text = await page.locator('main').textContent();
    expect(text).toContain(table(locale)['card_fp_insufficient']!.message);
    expect(text).toContain(table(locale)['phase_settlement_unobserved']!.message);
    expect(text).not.toContain(table(locale)['card_api_use_attempt_only']!.message);
    expect(text).not.toContain(table(locale)['card_fp_canvas_sequence']!.message);
    const observation = await page.locator('article').filter({ hasText: 'DET-003' }).locator('.levels__row').first().textContent();
    expect(observation).toContain('measureText');
    expect(observation).not.toMatch(/Отрисован|Text drawn/);
    expect(await page.locator('article').first().locator('.levels__row').nth(1).textContent()).toContain(table(locale)['alternative_high_volume_rendering']?.message ?? 'high-volume-rendering');
  });

  it('F060 keeps input boundaries visible in light, dark and forced colors', async () => {
    await mount('sidepanel');
    await page.addStyleTag({ content: readFileSync('packages/ui/src/styles/ui.css', 'utf8') });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const border = await page.locator('#panel-search').evaluate((element) => getComputedStyle(element).borderTopColor);
      expect(border).toBe(colorScheme === 'light' ? 'rgb(107, 118, 132)' : 'rgb(152, 162, 174)');
    }
    await page.emulateMedia({ forcedColors: 'active' });
    const colors = await page.locator('#panel-search').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.backgroundColor, style.borderTopWidth];
    });
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[2]).toBe('1px');
  });
});
