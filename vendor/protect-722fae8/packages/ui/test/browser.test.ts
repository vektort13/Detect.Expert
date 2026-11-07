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
type LocaleTable = ReturnType<typeof table>;
/** Resolves $NAME$ placeholders of a shipped locale entry, like chrome.i18n.getMessage. */
function fmt(messages: LocaleTable, key: string, subs: string[] = []): string {
  const entry = messages[key]!;
  return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
}
async function mountWith(surface: UiSurface, rep: ReturnType<typeof report>, locale = 'en') {
  await page.evaluate(({ surface, rep, messages }) => {
    window.uiAudit.report = rep;
    window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false };
    window.uiAudit.mount(surface, messages);
  }, { surface, rep, messages: table(locale) });
  await loaded();
}
/** S13 / E13-02: DET-002 hypothesis 2–9, DET-001 api-use 0–1, DET-032 api-use 40–41 (late start). */
function threeTechniques() {
  return report({
    coverageState: 'late-start',
    coverageFlags: ['late-start'],
    techniques: [
      technique({ techniqueId: 'DET-002', count: 4, firstBucket: 2, lastBucket: 9, signalCodes: ['api-use', 'readback-after-text'] }),
      technique({ techniqueId: 'DET-001', count: 1, firstBucket: 0, lastBucket: 1 }),
      technique({ techniqueId: 'DET-032', count: 2, firstBucket: 40, lastBucket: 41 }),
    ],
    findings: [finding({ findingId: 'fp', techniqueId: 'DET-002', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' })],
  });
}
const clearRequests = () => page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-clear'));
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

  it('F058/F139 retains focus and ordinary action semantics through resume and clear (S13: clear is confirmed first)', async () => {
    await mount('popup');
    await loaded();
    for (const key of ['action_resume', 'action_clear']) {
      const button = page.getByRole('button', { name: table()[key]!.message, exact: true });
      await button.evaluate((element) => { element.id = 'initiator'; });
      await button.focus();
      await page.evaluate(() => { window.uiAudit.delay = 50; });
      expect(await button.getAttribute('aria-pressed')).toBeNull();
      await button.press('Enter');
      if (key === 'action_clear') {
        await page.waitForFunction(() => document.activeElement?.closest('[role=alertdialog]') !== null);
        expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-clear'))).toBe(false);
        await page.locator('[role=alertdialog]').getByRole('button', { name: table()['confirm_clear_action']!.message, exact: true }).press('Enter');
      }
      await page.waitForFunction(() => document.getElementById('initiator')?.closest('[aria-busy]')?.getAttribute('aria-busy') === 'true');
      expect(await focused('initiator')).toBe(true);
      await page.waitForFunction(() => document.getElementById('initiator')?.closest('[aria-busy]')?.getAttribute('aria-busy') === 'false');
      expect(await focused('initiator')).toBe(true);
      await page.locator('#initiator').evaluate((element) => element.removeAttribute('id'));
    }
  });

  for (const locale of ['ru', 'en']) it('S11 ' + locale + ': options sensor families — described checkboxes, organization lock, notices, ui-set-sensor', async () => {
    const messages = table(locale);
    await page.evaluate((messages) => {
      const ids = ['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry'] as const;
      window.uiAudit.scope = {
        scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false,
        sensorSettings: {
          sensors: ids.map((sensorId) => sensorId === 'webgl'
            ? { sensorId, enabled: false, disabledBy: ['organization'] }
            : { sensorId, enabled: true, disabledBy: [] }),
          organizationPolicy: 'last-known-good',
          rejectedPolicyEntries: 2,
        },
      };
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelectorAll('[data-sensor-settings] input[type=checkbox]').length === 6);
    const section = page.locator('[data-sensor-settings]');
    expect(await section.locator('h2').textContent()).toBe(messages['options_sensors_title']!.message);
    expect(await section.textContent()).toContain(messages['options_sensors_desc']!.message);
    expect(await section.textContent()).toContain(messages['options_sensors_org_policy']!.message);
    expect(await section.textContent()).toContain(messages['options_sensors_policy_rejected']!.message.replace('$COUNT$', '2'));
    expect(await section.textContent()).toContain(messages['options_sensors_policy_lkg']!.message);
    const canvas = page.locator('#options-sensors-canvas');
    const webgl = page.locator('#options-sensors-webgl');
    expect(await canvas.isChecked()).toBe(true);
    expect(await webgl.isChecked()).toBe(false);
    expect(await webgl.isDisabled()).toBe(true);
    expect(await page.locator('#options-sensors-webgl-state').textContent()).toBe(messages['options_sensor_state_off_org']!.message);
    for (const id of ['canvas', 'webgl']) {
      const described = await page.locator('#options-sensors-' + id).getAttribute('aria-describedby');
      expect(described).toBe('options-sensors-' + id + '-desc options-sensors-' + id + '-state');
      expect(await page.locator('#options-sensors-' + id + '-desc').textContent()).toBe(messages['sensor_desc_' + id]!.message);
    }
    await canvas.click();
    await page.waitForFunction(() => window.uiAudit.requests.some((r) => r.type === 'ui-set-sensor'));
    expect(await page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-set-sensor'))).toEqual([
      { schemaVersion: 1, type: 'ui-set-sensor', sensorId: 'canvas', enabled: false },
    ]);
    await page.waitForFunction(() => document.querySelector('#options-sensors-canvas-state')?.getAttribute('data-sensor-state') === 'options_sensor_state_off_user');
    expect(await page.locator('.notice [role=status]').textContent()).toBe(messages['options_sensors_applied']!.message);
    expect(await canvas.isChecked()).toBe(false);
  });

  for (const locale of ['ru', 'en']) it('S12 ' + locale + ': options site access — rows, statuses, named remove buttons, revoke, focus to the neighbour', async () => {
    const messages = table(locale);
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com', 'other.example'], grantedAllSites: false, managed: false };
      window.uiAudit.origins = ['http://example.com/*', 'https://example.com/*', 'https://other.example/*', 'https://granted.example/*', '*://*.wild.example/*'];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelectorAll('[data-site-row]').length === 3);
    const section = page.locator('[data-site-access]');
    expect(await section.locator('h2').textContent()).toBe(messages['site_access_title']!.message);
    expect(await section.locator('h2').getAttribute('tabindex')).toBe('-1');
    expect(await section.textContent()).toContain(messages['site_access_desc']!.message);
    expect(await page.locator('[data-site-row]').evaluateAll((rows) => rows.map((row) => [row.getAttribute('data-site-row'), row.querySelector('[data-site-status]')?.getAttribute('data-site-status')]))).toEqual([
      ['example.com', 'site_status_observed'], ['other.example', 'site_status_observed'], ['granted.example', 'site_status_granted_only'],
    ]);
    expect(await section.textContent()).toContain(messages['site_access_other']!.message.replace('$N$', '1'));
    const named = messages['action_remove_site_named']!.message;
    expect(await page.locator('[data-remove-site="example.com"]').getAttribute('aria-label')).toBe(named.replace('$HOST$', 'example.com'));
    expect(await page.locator('[data-remove-site="example.com"]').textContent()).toBe(messages['action_remove_site']!.message);
    // ScopePicker shows the size of the list instead of the hosts themselves.
    expect(await page.locator('[data-scope-hosts-count]').textContent()).toContain(messages['scope_hosts_count']!.message.replace('$N$', '2'));

    await page.locator('[data-remove-site="example.com"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-site-row]').length === 2);
    expect(await page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-remove-site'))).toEqual([{ schemaVersion: 1, type: 'ui-remove-site', host: 'example.com' }]);
    expect(await page.evaluate(() => window.uiAudit.removedOrigins)).toEqual([['http://example.com/*', 'https://example.com/*']]);
    expect(await page.locator('.notice [role=status]').textContent()).toBe(messages['site_removed']!.message.replace('$HOST$', 'example.com'));
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-remove-site') === 'other.example');

    // The last row: focus moves to the previous button, then (no buttons left) to the heading.
    await page.locator('[data-remove-site="granted.example"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-site-row]').length === 1);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-remove-site') === 'other.example');
    await page.locator('[data-remove-site="other.example"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-site-row]').length === 0);
    await page.waitForFunction(() => document.activeElement?.id === 'site-access-title');
    expect(await page.evaluate(() => window.uiAudit.scope.scopeMode)).toBe('off');
    expect(await section.textContent()).toContain(messages['site_access_other']!.message.replace('$N$', '1'));
  });

  it('S12: a host still covered by all-sites access, a kept grant, revoke all, and the Chrome settings button', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'all-sites', hosts: ['example.com'], grantedAllSites: true, managed: false };
      window.uiAudit.origins = ['http://*/*', 'https://*/*', 'https://example.com/*'];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-revoke-all-sites]') !== null && document.querySelectorAll('[data-site-row]').length === 1);
    expect(await page.locator('[data-site-access]').textContent()).toContain(messages['site_all_sites']!.message);
    // CW-06: all-sites mode with the broad grant observes every site, so the listed host is «observed», not «not observed now».
    expect(await page.locator('[data-site-status]').getAttribute('data-site-status')).toBe('site_status_observed');
    expect(await page.locator('[data-all-sites-observed]').count()).toBe(1);
    expect(await page.locator('[data-site-access]').textContent()).toContain(messages['site_access_all_sites_observed']!.message);
    await page.locator('[data-remove-site="example.com"]').click();
    await page.waitForFunction((text) => document.querySelector('.notice [role=status]')?.textContent === text, messages['site_removed_all_sites_kept']!.message.replace('$HOST$', 'example.com'));
    expect(await page.evaluate(() => window.uiAudit.scope.scopeMode)).toBe('all-sites');

    await page.evaluate(() => { window.uiAudit.removeFails = true; });
    await page.locator('[data-revoke-all-sites]').click();
    await page.waitForFunction((text) => document.querySelector('.notice [role=status]')?.textContent === text, messages['access_revoke_failed']!.message);
    await page.evaluate(() => { window.uiAudit.removeFails = false; });
    await page.locator('[data-revoke-all-sites]').click();
    await page.waitForFunction((text) => document.querySelector('.notice [role=status]')?.textContent === text, messages['all_sites_revoked']!.message);
    expect(await page.evaluate(() => window.uiAudit.removedOrigins)).toEqual([['https://example.com/*'], ['http://*/*', 'https://*/*'], ['http://*/*', 'https://*/*']]);
    await page.waitForFunction(() => document.querySelector('[data-revoke-all-sites]') === null);
    expect(await page.locator('[data-site-access-empty]').textContent()).toBe(messages['site_access_none']!.message);

    await page.getByRole('button', { name: messages['action_open_chrome_site_access']!.message, exact: true }).click();
    await page.waitForFunction(() => window.uiAudit.createdTabs.length === 1);
    expect(await page.evaluate(() => window.uiAudit.createdTabs)).toEqual(['chrome://extensions/?id=abcdefghijklmnopabcdefghijklmnop']);
  });

  it('S12: a required (build) grant cannot be revoked; the host can still leave the list', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'site', hosts: ['127.0.0.1'], grantedAllSites: false, managed: false };
      window.uiAudit.origins = ['http://127.0.0.1/*'];
      window.uiAudit.required = ['http://127.0.0.1/*'];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-site-status="site_status_required"]') !== null);
    await page.locator('[data-remove-site="127.0.0.1"]').click();
    await page.waitForFunction((text) => document.querySelector('.notice [role=status]')?.textContent === text, messages['site_removed_access_kept']!.message.replace('$HOST$', '127.0.0.1'));
    expect(await page.evaluate(() => window.uiAudit.removedOrigins)).toEqual([]);
    expect(await page.evaluate(() => window.uiAudit.origins)).toEqual(['http://127.0.0.1/*']);
    // Required grant, not listed any more: nothing left to remove in the extension.
    await page.waitForFunction(() => document.querySelector('[data-remove-site]') === null);
  });

  it('S12: managed scope disables every site action', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: true };
      window.uiAudit.origins = ['https://example.com/*'];
      window.uiAudit.required = [];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-remove-site="example.com"]') !== null);
    expect(await page.locator('[data-remove-site="example.com"]').isDisabled()).toBe(true);
  });

  for (const revoke of [true, false]) it('S12: «Выключено» ' + (revoke ? 'with' : 'without') + ' revoking site access (checkbox on by default)', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false };
      window.uiAudit.origins = ['http://example.com/*', 'https://example.com/*', 'http://127.0.0.1/*', '<all_urls>'];
      window.uiAudit.required = ['http://127.0.0.1/*'];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelectorAll('[data-site-row]').length === 2);
    expect(await page.locator('#options-scope-off-revoke').count()).toBe(0);
    await page.locator('#options-scope-off').check();
    const box = page.locator('#options-scope-off-revoke');
    expect(await box.isChecked()).toBe(true);
    expect(await box.getAttribute('aria-describedby')).toBe('options-scope-off-revoke-desc');
    expect(await page.locator('#options-scope-off-revoke-desc').textContent()).toBe(messages['scope_off_revoke_desc']!.message);
    if (!revoke) await box.uncheck();
    await page.getByRole('button', { name: messages['action_apply']!.message, exact: true }).click();
    const key = revoke ? 'scope_off_access_revoked' : 'scope_off_access_kept';
    await page.waitForFunction((text) => document.querySelector('.notice [role=status]')?.textContent === text, messages[key]!.message);
    expect(await page.evaluate(() => window.uiAudit.requests.filter((r) => r.type === 'ui-set-scope'))).toEqual([{ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }]);
    // Optional http/https grants only: <all_urls> and the build's required pattern are never removed.
    expect(await page.evaluate(() => window.uiAudit.removedOrigins)).toEqual(revoke ? [['http://example.com/*', 'https://example.com/*']] : []);
  });

  it('S15 (ADR-003 v4 п. 3): with the module «Защита» on, revoking all-sites access says it suspends the module', async () => {
    const messages = table();
    const warning = messages['scope_protect_revoke_warning']!.message;
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'all-sites', hosts: [], grantedAllSites: true, managed: false };
      window.uiAudit.origins = ['http://*/*', 'https://*/*'];
      window.uiAudit.protectState = {
        state: 'active', consentVersion: 1, requiredConsentVersion: 1, features: ['value-match'], preset: 'normal', snoozedUntil: null, excludedSites: [],
        historyRetentionDays: 30, history: null, decisions: 0, permissions: { broadHosts: true, dnr: false }, organizationDisabled: false, organizationPolicyInvalid: false, degradedReasons: [],
      };
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-revoke-all-sites]') !== null && window.uiAudit.requests.some((r) => r.type === 'ui-protect-get-state'));
    await page.waitForFunction(() => document.querySelector('[data-site-access-protect-warning]') !== null);
    expect(await page.locator('[data-site-access-protect-warning]').textContent()).toBe(warning);
    expect(await page.locator('[data-revoke-all-sites]').getAttribute('aria-describedby')).toBe('site-access-protect-warning');
    expect(await page.locator('[data-scope-protect-warning]').count()).toBe(0);
    await page.locator('#options-scope-off').check();
    expect(await page.locator('#options-scope-off-revoke').isChecked()).toBe(true);
    expect(await page.locator('[data-scope-protect-warning]').textContent()).toBe(warning);
    await page.locator('#options-scope-off-revoke').uncheck();
    expect(await page.locator('[data-scope-protect-warning]').count()).toBe(0);
  });

  it('S15: without the module «Защита» the scope picker and site access carry no module warning', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'all-sites', hosts: [], grantedAllSites: true, managed: false };
      window.uiAudit.origins = ['http://*/*', 'https://*/*'];
      window.uiAudit.mount('options', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-revoke-all-sites]') !== null && window.uiAudit.requests.some((r) => r.type === 'ui-protect-get-state'));
    await page.locator('#options-scope-off').check();
    expect(await page.locator('#options-scope-off-revoke').isChecked()).toBe(true);
    expect(await page.locator('[data-scope-protect-warning], [data-site-access-protect-warning]').count()).toBe(0);
  });

  it('S12: popup scope picker shows the site count, opens Options to manage access, offers revoke only for «Выключено»', async () => {
    const messages = table();
    await page.evaluate((messages) => {
      window.uiAudit.scope = { scopeMode: 'site', hosts: ['example.com', 'other.example'], grantedAllSites: false, managed: false };
      window.uiAudit.origins = ['https://example.com/*'];
      window.uiAudit.report = null;
      window.uiAudit.mount('popup', messages);
    }, messages);
    await page.waitForFunction(() => document.querySelector('[data-scope-hosts-count]') !== null);
    await page.locator('details:has(form.scope) > summary').click();
    expect(await page.locator('[data-scope-hosts-count]').getAttribute('data-scope-hosts-count')).toBe('2');
    expect(await page.locator('form.scope').textContent()).not.toContain('other.example');
    expect(await page.locator('#popup-scope-off-revoke').count()).toBe(0);
    await page.locator('#popup-scope-off').check();
    expect(await page.locator('#popup-scope-off-revoke').isChecked()).toBe(true);
    await page.getByRole('button', { name: messages['action_manage_site_access']!.message, exact: true }).click();
    await page.waitForFunction(() => window.uiAudit.optionsOpened === 1);
  });

  it('S11: options without sensorSettings (older SW) render no sensor checkboxes and no notice', async () => {
    await page.evaluate((messages) => { window.uiAudit.mount('options', messages); }, table());
    await page.waitForFunction(() => document.querySelector('[data-sensor-settings]') !== null && window.uiAudit.requests.some((r) => r.type === 'ui-get-scope'));
    expect(await page.locator('[data-sensor-settings] input').count()).toBe(0);
    expect(await page.locator('[data-sensor-notice]').count()).toBe(0);
  });

  it('F058 retains focus after scope apply and session clear in options (S13: session clear is confirmed first)', async () => {
    await mount('options');
    await loaded();
    await page.locator('#options-scope-all-sites').check();
    for (const key of ['action_apply', 'options_clear_session']) {
      const button = page.getByRole('button', { name: table()[key]!.message, exact: true });
      await button.evaluate((element) => { element.id = 'initiator'; });
      await page.evaluate(() => { window.uiAudit.delay = 50; });
      await button.focus();
      await button.press('Enter');
      if (key === 'options_clear_session') {
        const dialog = page.locator('#options-confirm-clear-session');
        await page.waitForFunction(() => document.activeElement?.closest('#options-confirm-clear-session') !== null);
        expect(await dialog.getAttribute('role')).toBe('alertdialog');
        expect(await page.locator('#options-confirm-clear-session-title').textContent()).toBe(table()['confirm_clear_session_title']!.message);
        expect(await page.locator('#options-confirm-clear-session-desc').textContent()).toBe(table()['confirm_clear_session_desc']!.message);
        // Escape cancels: nothing is sent, focus is back on the initiator; then confirm for real.
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.getElementById('options-confirm-clear-session') === null && document.activeElement?.id === 'initiator');
        expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-clear-session'))).toBe(false);
        await button.press('Enter');
        await dialog.getByRole('button', { name: table()['confirm_clear_session_action']!.message, exact: true }).click();
      }
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
    await page.locator('[role=alertdialog]').getByRole('button', { name: table()['confirm_clear_action']!.message, exact: true }).click();
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

  for (const surface of ['popup', 'sidepanel'] as const) it('S13 ' + surface + ': cancel and Escape send no ui-clear; confirm sends exactly one ui-clear with the original key', async () => {
    await mount(surface);
    await loaded();
    const prefix = surface === 'popup' ? 'popup' : 'panel';
    const clear = page.getByRole('button', { name: table()['action_clear']!.message, exact: true });
    const dialog = page.locator('#' + prefix + '-confirm-clear');
    expect(await dialog.count()).toBe(0);
    await clear.evaluate((element) => { element.id = 'initiator'; });
    for (const close of ['cancel', 'escape', 'confirm'] as const) {
      await clear.focus();
      await clear.press('Enter');
      await page.waitForFunction((id) => document.getElementById(id)?.matches('dialog[open]') === true, prefix + '-confirm-clear');
      expect(await dialog.getAttribute('role')).toBe('alertdialog');
      expect(await dialog.getAttribute('aria-modal')).toBe('true');
      expect(await dialog.getAttribute('aria-labelledby')).toBe(prefix + '-confirm-clear-title');
      expect(await dialog.getAttribute('aria-describedby')).toBe(prefix + '-confirm-clear-desc');
      expect(await page.locator('#' + prefix + '-confirm-clear-title').textContent()).toBe(table()['confirm_clear_title']!.message);
      expect(await page.locator('#' + prefix + '-confirm-clear-desc').textContent()).toBe(fmt(table(), 'confirm_clear_desc', ['example.com']));
      // Initial focus on «Cancel»; the confirm button is the ordinary primary style, not the error colour.
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(table()['action_cancel']!.message);
      expect(await dialog.locator('.button--primary').textContent()).toBe(table()['confirm_clear_action']!.message);
      expect(await dialog.locator('.button--primary').evaluate((element) => element.className)).not.toMatch(/error|danger/);
      if (close === 'cancel') await dialog.getByRole('button', { name: table()['action_cancel']!.message, exact: true }).click();
      else if (close === 'escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: table()['confirm_clear_action']!.message, exact: true }).click();
      await page.waitForFunction((id) => document.getElementById(id) === null && document.activeElement?.id === 'initiator', prefix + '-confirm-clear');
      if (close !== 'confirm') expect(await clearRequests()).toEqual([]);
    }
    await page.waitForFunction(() => window.uiAudit.requests.filter((r) => r.type === 'ui-clear').length === 1);
    expect(await clearRequests()).toEqual([{ schemaVersion: 1, type: 'ui-clear', tabId: 12, documentKey: '12:0:doc-a', reportRevision: 7 }]);
  });

  it('S13: a document change closes the confirmation without deleting anything', async () => {
    await mount('sidepanel');
    await loaded();
    await page.getByRole('button', { name: table()['action_clear']!.message, exact: true }).click();
    await page.waitForFunction(() => document.getElementById('panel-confirm-clear') !== null);
    await page.evaluate(() => { window.uiAudit.report = { ...window.uiAudit.report!, documentKey: '12:0:doc-b' }; });
    await page.waitForFunction(() => document.getElementById('panel-confirm-clear') === null, undefined, { timeout: 5000 });
    expect(await clearRequests()).toEqual([]);
    expect(await page.locator('.notice [role=status]').textContent()).toBe(fmt(table(), 'coverage_context_changed', ['example.com']));
  });

  it('S13: clear() refuses a key that is no longer shown (useReportSession)', async () => {
    await mount('popup', { probe: true });
    await page.waitForFunction(() => window.uiAudit.session?.loaded && window.uiAudit.session.report !== null);
    await page.evaluate(() => window.uiAudit.session!.clear('12:0:other'));
    expect(await clearRequests()).toEqual([]);
    expect(await page.locator('[role=status]').textContent()).toBe(fmt(table(), 'coverage_context_changed', ['example.com']));
  });

  for (const [state, key] of [['no-access', 'export_unavailable_no_access'], ['unsupported', 'export_unavailable_unsupported']] as const) it('S13: export at ' + state + ' stays focusable, is described by the reason and does nothing', async () => {
    await mountWith('popup', report({ coverageState: state, techniques: [technique({ techniqueId: 'DET-002' })] }));
    const button = page.getByRole('button', { name: table()['action_export']!.message, exact: true });
    await page.waitForFunction(() => document.getElementById('popup-export-reason') !== null);
    // Not the `disabled` property (Playwright's isDisabled() also counts aria-disabled): it stays in the tab order.
    expect(await button.evaluate((element) => (element as HTMLButtonElement).disabled)).toBe(false);
    expect(await button.getAttribute('aria-disabled')).toBe('true');
    expect(await button.getAttribute('aria-describedby')).toBe('popup-export-reason');
    expect(await page.locator('#popup-export-reason').textContent()).toBe(table()[key]!.message);
    await button.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-describedby'))).toBe('popup-export-reason');
    await button.press('Enter');
    await button.evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.uiAudit.requests.some((r) => r.type === 'ui-export-preview'))).toBe(false);
    expect(await page.locator('#export-dialog').evaluate((element) => (element as HTMLDialogElement).open)).toBe(false);
  });

  it('S13: export is available (no reason, not aria-disabled) for an observed document', async () => {
    await mountWith('popup', report({ coverageState: 'active', techniques: [technique({ techniqueId: 'DET-002' })] }));
    const button = page.getByRole('button', { name: table()['action_export']!.message, exact: true });
    await page.waitForFunction(() => document.querySelector('[aria-busy]') !== null);
    expect(await button.getAttribute('aria-disabled')).toBe('false');
    expect(await button.getAttribute('aria-describedby')).toBeNull();
    expect(await page.locator('#popup-export-reason').count()).toBe(0);
  });

  for (const locale of ['ru', 'en']) it('S13 ' + locale + ': side-panel filters, polite summary, reset keeps focus, grouping, timeline and card details', async () => {
    const messages = table(locale);
    await mountWith('sidepanel', threeTechniques(), locale);
    await page.locator('#panel-tab-techniques').click();
    const summary = page.locator('#panel-filters-summary');
    const region = page.locator('#panel-search-feedback');
    await page.waitForFunction(() => document.querySelectorAll('[id^="panel-techniques-card-"]').length === 3);
    expect(await summary.textContent()).toBe(fmt(messages, 'filter_summary', ['3', '3']));
    expect(await summary.getAttribute('aria-live')).toBeNull();
    // Only page-hook data: no source select; the other selects list present values with counts.
    expect(await page.locator('#panel-filters-source').count()).toBe(0);
    expect(await page.locator('#panel-filters-category option').allTextContents()).toEqual([
      messages['filter_all']!.message,
      fmt(messages, 'filter_option_count', [messages['category_graphics']!.message, '2']),
      fmt(messages, 'filter_option_count', [messages['category_environment']!.message, '1']),
    ]);
    expect(await page.locator('#panel-filters-kind option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))).toEqual(['all', 'possible-fingerprinting', 'api-use']);
    expect(await page.locator('label[for="panel-filters-kind"]').textContent()).toBe(messages['filter_kind']!.message);

    await page.locator('#panel-filters-category').selectOption('environment');
    expect(await summary.textContent()).toBe(fmt(messages, 'filter_summary', ['1', '3']));
    expect(await page.locator('[id^="panel-techniques-card-"]').count()).toBe(1);
    // The persistent polite region announces the filter result even without a query.
    await page.waitForFunction((text) => document.getElementById('panel-search-feedback')?.textContent === text, fmt(messages, 'filter_summary', ['1', '3']));

    // Reset keeps focus on the reset button and restores every select.
    const reset = page.getByRole('button', { name: messages['filter_reset']!.message, exact: true });
    await reset.focus();
    await reset.press('Enter');
    expect(await summary.textContent()).toBe(fmt(messages, 'filter_summary', ['3', '3']));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(messages['filter_reset']!.message);
    expect(await page.locator('#panel-filters-category').inputValue()).toBe('all');
    await page.waitForFunction(() => document.getElementById('panel-search-feedback')?.textContent === '');

    await page.locator('#panel-filters-kind').selectOption('possible-fingerprinting');
    expect(await summary.textContent()).toBe(fmt(messages, 'filter_summary', ['1', '3']));
    // Query and filter together: nothing matches → filter_empty, visible and announced.
    await page.locator('#panel-search').fill('DET-001');
    expect(await page.locator('[data-filter-empty]').textContent()).toBe(messages['filter_empty']!.message);
    await page.waitForFunction((text) => document.getElementById('panel-search-feedback')?.textContent?.endsWith(text) === true, messages['filter_empty']!.message, { timeout: 5000 });
    expect(await region.textContent()).toBe(messages['search_label']!.message + ': DET-001. ' + messages['filter_empty']!.message);
    await page.locator('#panel-search').fill('');
    await reset.click();

    // Grouping by interpretation: hypotheses first, sizes add up.
    await page.locator('#panel-filters-group').selectOption('kind');
    expect(await page.locator('#panel-panel-techniques .group__title[id^="group-kind-"]').allTextContents()).toEqual([
      messages['card_fp_label']!.message + ' (1)',
      messages['card_api_use_label']!.message + ' (2)',
    ]);
    await page.locator('#panel-filters-group').selectOption('category');
    expect(await page.locator('#panel-panel-techniques .group__title[id^="group-category-"]').allTextContents()).toEqual([
      messages['category_graphics']!.message + ' (2)',
      messages['category_environment']!.message + ' (1)',
    ]);

    // Timeline after the groups: page-hook rows by first bucket, text rows, decorative bars.
    const timeline = page.locator('[data-activity-timeline]');
    expect(await timeline.locator('h3').textContent()).toBe(messages['timeline_title']!.message);
    expect(await timeline.textContent()).toContain(messages['timeline_desc']!.message);
    expect(await timeline.locator('[data-timeline-late-start]').textContent()).toBe(messages['timeline_late_start']!.message);
    expect(await timeline.locator('[data-timeline-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-timeline-row')))).toEqual(['DET-001', 'DET-002', 'DET-032']);
    expect(await timeline.locator('[data-timeline-row="DET-002"] .timeline__text').textContent()).toBe(fmt(messages, 'timeline_row', [
      'DET-002 CanvasRenderingContext2D.getImageData', messages['time_offset_under_second']!.message, fmt(messages, 'time_offset_seconds', ['2']),
    ]));
    expect(await timeline.locator('.timeline__track').evaluateAll((tracks) => tracks.every((track) => track.getAttribute('aria-hidden') === 'true'))).toBe(true);
    expect(await page.evaluate(() => {
      const groups = document.querySelectorAll('#panel-panel-techniques .group');
      const last = groups[groups.length - 1]!;
      return Boolean(last.compareDocumentPosition(document.querySelector('[data-activity-timeline]')!) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    // Filtering narrows the timeline too.
    await page.locator('#panel-filters-category').selectOption('environment');
    expect(await timeline.locator('[data-timeline-row]').count()).toBe(1);
    await reset.click();

    // Card details: activity, page-context signals, document.
    const card = page.locator('#panel-panel-techniques article').filter({ hasText: 'DET-002' });
    await card.locator('summary').click();
    const details = await card.locator('.card__details').textContent();
    expect(details).toContain(messages['detail_activity']!.message);
    expect(details).toContain(fmt(messages, 'detail_activity_value', [messages['time_offset_under_second']!.message, fmt(messages, 'time_offset_seconds', ['2'])]));
    expect(details).toContain(messages['detail_signals']!.message);
    expect(details).toContain(messages['signal_readback_after_text']!.message);
    expect(details).toContain(messages['detail_document_top']!.message);
  });

  it('S13: filters reset when the document changes; the search query stays', async () => {
    await mountWith('sidepanel', threeTechniques());
    await page.locator('#panel-tab-techniques').click();
    await page.locator('#panel-filters-category').selectOption('graphics');
    await page.locator('#panel-search').fill('det');
    expect(await page.locator('#panel-filters-summary').textContent()).toBe(fmt(table(), 'filter_summary', ['2', '3']));
    await page.evaluate(() => { window.uiAudit.report = { ...window.uiAudit.report!, documentKey: '12:0:doc-b' }; });
    await page.waitForFunction(() => (document.getElementById('panel-filters-category') as HTMLSelectElement | null)?.value === 'all', undefined, { timeout: 5000 });
    expect(await page.locator('#panel-search').inputValue()).toBe('det');
    expect(await page.locator('#panel-filters-summary').textContent()).toBe(fmt(table(), 'filter_summary', ['3', '3']));
  });

  it('S13: a browser-network technique adds the source select and never enters the timeline', async () => {
    const rep = threeTechniques();
    rep.techniques.push(technique({ techniqueId: 'DET-059', count: 5, evidenceSource: 'browser-network', integrity: 'browser-observed', firstBucket: 0, lastBucket: 900 }));
    await mountWith('sidepanel', rep);
    await page.locator('#panel-tab-techniques').click();
    await page.waitForFunction(() => document.getElementById('panel-filters-source') !== null);
    expect(await page.locator('#panel-filters-source option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))).toEqual(['all', 'browser-network', 'page-hook']);
    expect(await page.locator('[data-timeline-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-timeline-row')))).toEqual(['DET-001', 'DET-002', 'DET-032']);
    await page.locator('#panel-filters-source').selectOption('browser-network');
    expect(await page.locator('[data-activity-timeline]').count()).toBe(0);
    expect(await page.locator('#panel-filters-summary').textContent()).toBe(fmt(table(), 'filter_summary', ['1', '4']));
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
