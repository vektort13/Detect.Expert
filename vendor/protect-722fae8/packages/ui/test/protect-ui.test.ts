// ADR-020 «Защита» (S06): the module UI foundation in real Chromium (DOM, focus, dialogs, user activation) with a
// mocked privileged channel. Checks: the consent screen (defaults, aria-disabled confirm with a visible reason, focus on
// the heading, focus trap, Escape), chrome.permissions.request inside the click and before ui-protect-enable, the
// Options layouts (one section while off; tabs otherwise; hash), «Выключить» (purge ticked, permissions.remove after
// the SW answer), the organization policy, and popup / side panel unchanged while the module is off.
// The harness is bundled from the string below (test-only, never part of a product entry); pages are served by
// page.route from memory, nothing leaves the machine.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProtectState } from '@detect-expert/contracts';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const DNR = 'declarativeNetRequestWithHostAccess';
const ALL = ['http://*/*', 'https://*/*'];

const HARNESS = String.raw`
import { h, render } from 'preact';
import { PRODUCTION_CATALOG } from '@detect-expert/catalog';
import { PopupApp } from '../src/app/PopupApp';
import { SidepanelApp } from '../src/app/SidepanelApp';
import { OptionsApp } from '../src/app/OptionsApp';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const OFF_EMPTY = { state: 'off', consentVersion: null, requiredConsentVersion: 1, features: [], preset: 'normal', snoozedUntil: null,
  excludedSites: [], historyRetentionDays: 30, history: null, decisions: 0, permissions: { broadHosts: false, dnr: false },
  organizationDisabled: false, organizationPolicyInvalid: false, degradedReasons: [] };
const harness = { state: null, report: null, grant: true, page: 'options', log: [], requests: [], permissionCalls: [], createdTabs: [], offEmpty: OFF_EMPTY };
window.protectHarness = harness;

function stateAnswer() { return { schemaVersion: 1, type: 'protect-state', state: harness.state }; }
function answer(request) {
  const widening = request.type === 'ui-protect-enable' || request.type === 'ui-protect-set-settings' || (request.type === 'ui-protect-set-site' && !request.excluded);
  if (widening && harness.page !== 'options') return { schemaVersion: 1, type: 'error', code: 'unauthorized-sender' };
  switch (request.type) {
    case 'ui-get-scope': return { schemaVersion: 1, type: 'scope', scope: { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false } };
    case 'ui-get-report': return { schemaVersion: 1, type: 'report', report: null };
    case 'ui-protect-get-state': return harness.state === null ? { schemaVersion: 1, type: 'ok', reportRevision: null } : stateAnswer();
    case 'ui-protect-enable':
      harness.state = { ...harness.state, state: 'active', consentVersion: request.consentVersion, features: request.features, preset: request.preset,
        permissions: { broadHosts: true, dnr: request.features.includes('firewall') || request.features.includes('gpc') } };
      return stateAnswer();
    case 'ui-protect-set-settings':
      harness.state = { ...harness.state, ...(request.features ? { features: request.features } : {}), ...(request.preset ? { preset: request.preset } : {}) };
      return stateAnswer();
    case 'ui-protect-disable':
      harness.state = request.purge ? { ...OFF_EMPTY } : { ...harness.state, state: 'off' };
      return stateAnswer();
    case 'ui-protect-purge': harness.state = { ...OFF_EMPTY }; return stateAnswer();
    case 'ui-protect-snooze': harness.state = { ...harness.state, snoozedUntil: request.minutes === 0 ? null : Date.now() + 3600000 }; return stateAnswer();
    case 'ui-protect-set-site': {
      const sites = harness.state.excludedSites.filter((s) => s !== request.host);
      if (request.excluded) sites.push(request.host);
      harness.state = { ...harness.state, excludedSites: sites.sort() };
      return stateAnswer();
    }
    case 'ui-protect-get-report': return { schemaVersion: 1, type: 'protect-report', report: harness.report };
    default: return { schemaVersion: 1, type: 'ok', reportRevision: null };
  }
}
const noopEvent = { addListener() {}, removeListener() {} };
harness.mount = (surface, table) => {
  window.chrome = {
    i18n: {
      getUILanguage: () => 'ru',
      getMessage: (key, subs = []) => {
        const entry = table[key];
        if (!entry) return '';
        return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name) => subs[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
      },
    },
    runtime: {
      id: ID,
      getURL: (path) => 'chrome-extension://' + ID + '/' + path,
      getManifest: () => ({ version: '0.1.0', host_permissions: [] }),
      openOptionsPage: async () => {},
      sendMessage: async (request) => {
        harness.requests.push(request);
        harness.log.push('send:' + request.type);
        await new Promise((r) => setTimeout(r, 5));
        const out = answer(request);
        harness.log.push('answer:' + request.type);
        return out;
      },
    },
    permissions: {
      request: (req) => {
        harness.log.push('permissions.request');
        harness.permissionCalls.push({ req, userActivation: navigator.userActivation.isActive });
        return new Promise((r) => setTimeout(() => r(harness.grant), 5));
      },
      remove: async (req) => { harness.log.push('permissions.remove:' + JSON.stringify(req)); return true; },
      getAll: async () => ({ origins: [], permissions: [] }),
      contains: async () => false,
      onAdded: noopEvent, onRemoved: noopEvent,
    },
    tabs: {
      query: async () => [{ id: 12, url: 'https://example.com/' }],
      get: async (id) => ({ id }),
      create: async ({ url }) => { harness.createdTabs.push(url); return { id: 99 }; },
      reload: async () => {},
      onActivated: noopEvent,
    },
    storage: { local: { onChanged: noopEvent } },
    sidePanel: { open: async () => {} },
  };
  const root = document.createElement('div');
  document.body.append(root);
  render(surface === 'popup' ? h(PopupApp, { catalog: PRODUCTION_CATALOG }) : surface === 'sidepanel' ? h(SidepanelApp, { catalog: PRODUCTION_CATALOG }) : h(OptionsApp, {}), root);
};
`;

interface HarnessView {
  log: string[];
  requests: Array<Record<string, unknown>>;
  permissionCalls: Array<{ req: { origins: string[]; permissions: string[] }; userActivation: boolean }>;
  createdTabs: string[];
}

let browser: Browser;
let page: Page;
let script: string;

beforeAll(async () => {
  script = (await build({
    stdin: { contents: HARNESS, loader: 'tsx', resolveDir: resolve('packages/ui/test'), sourcefile: 'protect-ui-harness.tsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact',
  })).outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
}, 30_000);
beforeEach(async () => {
  page = await browser.newPage();
  await page.route('http://protect-ui.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>' }));
});
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser?.close(); });

function state(over: Partial<ProtectState> = {}): ProtectState {
  return {
    state: 'off', consentVersion: null, requiredConsentVersion: 1, features: [], preset: 'normal', snoozedUntil: null, excludedSites: [],
    historyRetentionDays: 30, history: null, decisions: 0, permissions: { broadHosts: false, dnr: false }, organizationDisabled: false,
    organizationPolicyInvalid: false, degradedReasons: [], ...over,
  };
}
const ACTIVE = state({ state: 'active', consentVersion: 1, features: ['value-match', 'firewall', 'session-replay'], permissions: { broadHosts: true, dnr: true }, decisions: 2 });

async function open(surface: 'options' | 'popup' | 'sidepanel', protect: ProtectState | null, options: { hash?: string; grant?: boolean } = {}) {
  await page.goto('http://protect-ui.test/' + surface + '.html' + (options.hash ?? ''));
  await page.addScriptTag({ content: script });
  await page.evaluate(({ surface, protect, table, grant }) => {
    const harness = (window as unknown as { protectHarness: Record<string, unknown> & { mount(s: string, t: unknown): void } }).protectHarness;
    harness['state'] = protect;
    harness['grant'] = grant;
    harness['page'] = surface;
    harness.mount(surface, table);
  }, { surface, protect, table: ru, grant: options.grant ?? true });
  await page.waitForFunction(() => (window as unknown as { protectHarness: HarnessView }).protectHarness.log.includes('answer:ui-protect-get-state'));
}
const view = () => page.evaluate(() => {
  const h = (window as unknown as { protectHarness: HarnessView }).protectHarness;
  return { log: [...h.log], requests: [...h.requests], permissionCalls: [...h.permissionCalls], createdTabs: [...h.createdTabs] };
});
const text = (key: string, subs: string[] = []) => ru[key]!.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(ru[key]!.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
const focusedId = () => page.evaluate(() => document.activeElement?.id ?? '');

describe('Options: enabling through the consent screen', () => {
  it('module off: previous page plus one section at the end; consent defaults, aria-disabled confirm, focus, Escape', async () => {
    await open('options', state());
    await page.waitForSelector('[data-protect-section="enable-only"]');
    expect(await page.locator('[role=tablist]').count()).toBe(0);
    expect(await page.evaluate(() => document.querySelector('main')!.lastElementChild?.getAttribute('data-protect-section'))).toBe('enable-only');
    // The page's notice keeps the only role=status (existing tests address it with [role=status]).
    expect(await page.locator('[role=status]').count()).toBe(1);
    expect(await page.locator('[data-protect-section] button').count()).toBe(1);
    expect(await page.locator('[data-protect-state]').textContent()).toBe(text('protect_state_off'));

    const enable = page.getByRole('button', { name: text('protect_enable'), exact: true });
    await enable.click();
    const dialog = page.locator('#protect-consent');
    await expect.poll(() => dialog.evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
    expect(await focusedId()).toBe('protect-consent-title');
    expect(await dialog.getAttribute('aria-labelledby')).toBe('protect-consent-title');
    expect(await page.locator('[data-consent-block]').count()).toBe(7);
    const checked = await page.evaluate(() => ['value-match', 'firewall', 'session-replay', 'history', 'gpc'].map((f) => (document.getElementById('protect-consent-feature-' + f) as HTMLInputElement).checked));
    expect(checked).toEqual([true, true, true, false, false]);
    expect(await page.locator('#protect-consent-preset-normal').isChecked()).toBe(true);
    // Review TRUTH-06: the strict preset is described by the warning that protection services are not recognized.
    expect(await page.locator('#protect-consent-preset-strict').getAttribute('aria-describedby')).toBe('protect-consent-strict-warning');
    expect(await page.locator('#protect-consent-strict-warning').textContent()).toBe(text('fw_mode_strict_warning'));
    expect(await page.locator('#protect-consent-strict-warning').isVisible()).toBe(true);
    const confirm = page.locator('[data-consent-confirm]');
    expect(await confirm.getAttribute('aria-disabled')).toBe('true');
    expect(await confirm.getAttribute('aria-describedby')).toBe('protect-consent-hint');
    expect(await page.locator('#protect-consent-hint').textContent()).toBe(text('protect_consent_ack_required'));
    expect(await page.locator('#protect-consent-hint').isVisible()).toBe(true);
    // aria-disabled keeps the button focusable; activating it only points at the reason.
    await confirm.focus();
    await page.keyboard.press('Enter');
    expect(await focusedId()).toBe('protect-consent-hint');
    let v = await view();
    expect(v.permissionCalls).toEqual([]);
    expect(v.requests.some((r) => r['type'] === 'ui-protect-enable')).toBe(false);

    // Focus trap: Tab from the last control returns to the first; Shift+Tab from the heading goes to the last.
    await page.locator('#protect-consent-title').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-consent-confirm'))).toBe('true');
    await page.keyboard.press('Tab');
    expect(await focusedId()).toBe('protect-consent-feature-value-match');

    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('#protect-consent').count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-protect-enable'))).toBe('true');
    v = await view();
    expect(v.requests.some((r) => r['type'] === 'ui-protect-enable')).toBe(false);
  });

  it('confirm: chrome.permissions.request inside the click (user activation), then ui-protect-enable; tabs and #protect follow', async () => {
    await open('options', state());
    await page.getByRole('button', { name: text('protect_enable'), exact: true }).click();
    await page.locator('#protect-consent-ack').check();
    expect(await page.locator('[data-consent-confirm]').getAttribute('aria-disabled')).toBe('false');
    expect(await page.locator('#protect-consent-hint').count()).toBe(0);
    await page.locator('[data-consent-confirm]').click();
    await page.waitForSelector('[role=tablist]');
    const v = await view();
    const sequence = v.log.filter((entry) => entry === 'permissions.request' || entry === 'send:ui-protect-enable');
    expect(sequence).toEqual(['permissions.request', 'send:ui-protect-enable']);
    expect(v.permissionCalls).toEqual([{ req: { origins: ALL, permissions: [DNR] }, userActivation: true }]);
    expect(v.requests.filter((r) => r['type'] === 'ui-protect-enable')).toEqual([
      { schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'firewall', 'session-replay'], preset: 'normal' },
    ]);
    expect(await page.locator('#options-tab-protect').getAttribute('aria-selected')).toBe('true');
    expect(await page.evaluate(() => location.hash)).toBe('#protect');
    await expect.poll(focusedId).toBe('protect-title');
    expect(await page.locator('[data-protect-state]').textContent()).toBe(text('protect_state_active'));
    expect(await page.locator('[data-protect-message]').textContent()).toBe(text('protect_reload_note'));
    // Switching back to «Наблюдение» drops the hash.
    await page.locator('#options-tab-observation').click();
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  it('without firewall and gpc the DNR permission is not requested; a refusal keeps the module off', async () => {
    await open('options', state(), { grant: false });
    await page.getByRole('button', { name: text('protect_enable'), exact: true }).click();
    await page.locator('#protect-consent-feature-firewall').uncheck();
    await page.locator('#protect-consent-ack').check();
    await page.locator('[data-consent-confirm]').click();
    await expect.poll(() => page.locator('[data-consent-error]').textContent()).toBe(text('protect_permission_denied'));
    const v = await view();
    expect(v.permissionCalls).toEqual([{ req: { origins: ALL, permissions: [] }, userActivation: true }]);
    expect(v.requests.some((r) => r['type'] === 'ui-protect-enable')).toBe(false);
    expect(await page.locator('#protect-consent').count()).toBe(1);
  });

  it('#firewall opens the «Защита» tab; turning on gpc asks for DNR in the change event', async () => {
    await open('options', { ...ACTIVE, features: ['value-match'], permissions: { broadHosts: true, dnr: false } }, { hash: '#firewall' });
    await page.waitForSelector('[role=tablist]');
    expect(await page.locator('#options-tab-protect').getAttribute('aria-selected')).toBe('true');
    expect(await page.locator('#protect-feature-value-match').isDisabled()).toBe(true);
    await page.locator('#protect-feature-gpc').click();
    await expect.poll(async () => (await view()).requests.some((r) => r['type'] === 'ui-protect-set-settings')).toBe(true);
    const v = await view();
    expect(v.log.filter((e) => e === 'permissions.request' || e === 'send:ui-protect-set-settings')).toEqual(['permissions.request', 'send:ui-protect-set-settings']);
    expect(v.permissionCalls[0]).toEqual({ req: { origins: ALL, permissions: [DNR] }, userActivation: true });
    expect(v.requests.find((r) => r['type'] === 'ui-protect-set-settings')).toEqual({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match', 'gpc'] });
    await expect.poll(() => page.locator('#protect-feature-gpc').isChecked()).toBe(true);
  });
});

describe('Options: running module', () => {
  it('«Выключить» deletes data by default; permissions.remove only after the SW answer; back to one section', async () => {
    await open('options', ACTIVE, { hash: '#protect' });
    await page.waitForSelector('[data-protect-section="full"]');
    expect(await page.locator('#protect-disable-purge').isChecked()).toBe(true);
    expect(await page.locator('[data-protect-decisions]').textContent()).toBe(text('protect_decisions_count', ['2']));
    await page.getByRole('button', { name: text('protect_disable'), exact: true }).click();
    await page.waitForSelector('[data-protect-section="enable-only"]');
    const v = await view();
    expect(v.requests.find((r) => r['type'] === 'ui-protect-disable')).toEqual({ schemaVersion: 1, type: 'ui-protect-disable', purge: true });
    const order = v.log.filter((e) => e === 'answer:ui-protect-disable' || e.startsWith('permissions.remove'));
    expect(order).toEqual(['answer:ui-protect-disable', 'permissions.remove:' + JSON.stringify({ permissions: [DNR] })]);
    await expect.poll(focusedId).toBe('protect-title');
    expect(await page.locator('[data-protect-message]').textContent()).toBe(text('protect_disabled_notice'));
  });

  it('excluded sites: invalid input is explained; add and remove send sanitized hosts', async () => {
    await open('options', ACTIVE, { hash: '#protect' });
    await page.waitForSelector('[data-protect-sites]');
    await page.locator('#protect-site-input').fill('not a host');
    await page.getByRole('button', { name: text('protect_sites_add'), exact: true }).click();
    expect(await page.locator('#protect-site-invalid').textContent()).toBe(text('protect_sites_invalid'));
    await page.locator('#protect-site-input').fill('https://Bank.Example/login?x=1');
    await page.getByRole('button', { name: text('protect_sites_add'), exact: true }).click();
    // The hidden «Наблюдение» panel has its own access list: scope to the module section.
    await page.waitForSelector('[data-protect-sites] .access-list__host');
    expect(await page.locator('[data-protect-sites] .access-list__host').textContent()).toBe('bank.example');
    await page.getByRole('button', { name: text('action_remove_site_named', ['bank.example']), exact: true }).click();
    await page.waitForSelector('[data-protect-sites] .access-list', { state: 'detached' });
    const v = await view();
    expect(v.requests.filter((r) => r['type'] === 'ui-protect-set-site')).toEqual([
      { schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank.example', excluded: true },
      { schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank.example', excluded: false },
    ]);
  });

  it('organization policy: no enabling, the policy is explained, module data can still be deleted (confirmed first)', async () => {
    // S09 follow-up: tabs follow protectSurfaceVisible — this user had enabled the module before the policy.
    await open('options', state({ state: 'organization-disabled', organizationDisabled: true, consentVersion: 1, features: ['value-match'] }), { hash: '#protect' });
    await page.waitForSelector('[role=tablist]');
    expect(await page.locator('[data-protect-enable]').count()).toBe(0);
    expect(await page.locator('[data-protect-notice="protect_org_policy"]').textContent()).toBe(text('protect_org_policy'));
    await page.locator('[data-protect-purge]').click();
    const dialog = page.getByRole('alertdialog');
    await expect.poll(() => dialog.count()).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(text('action_cancel'));
    await page.keyboard.press('Escape');
    expect((await view()).requests.some((r) => r['type'] === 'ui-protect-purge')).toBe(false);
  });
});

describe('popup and side panel', () => {
  it('popup, module off: no module area, no report polling, nothing widening', async () => {
    await open('popup', state());
    await page.waitForSelector('#coverage');
    await page.waitForTimeout(1300);
    expect(await page.locator('[data-protect-area]').count()).toBe(0);
    const v = await view();
    expect(v.requests.filter((r) => String(r['type']).startsWith('ui-protect-')).map((r) => r['type'])).toEqual(['ui-protect-get-state']);
  });

  it('popup, SW without the module answer: same as off', async () => {
    await open('popup', null);
    await page.waitForSelector('#coverage');
    expect(await page.locator('[data-protect-area]').count()).toBe(0);
  });

  it('popup, module on: area first after Header / Notice, status line, settings link to options.html#protect', async () => {
    await open('popup', ACTIVE);
    await page.waitForSelector('[data-protect-area]');
    expect(await page.evaluate(() => document.querySelector('[data-protect-area]')!.nextElementSibling?.id)).toBe('coverage');
    expect(await page.locator('#popup-protect-status .state__line').first().textContent()).toBe(text('protect_status_line', [text('protect_state_active')]));
    await page.getByRole('button', { name: text('protect_settings_link'), exact: true }).click();
    await expect.poll(async () => (await view()).createdTabs).toEqual(['chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html#protect']);
    await expect.poll(async () => (await view()).requests.filter((r) => r['type'] === 'ui-protect-get-report').length).toBeGreaterThanOrEqual(2);
    const v = await view();
    expect(v.requests.some((r) => ['ui-protect-enable', 'ui-protect-set-settings'].includes(String(r['type'])))).toBe(false);
    expect(v.permissionCalls).toEqual([]);
  });

  it('side panel: four tabs while off, «Защита» and «Кто узнаёт» while on', async () => {
    await open('sidepanel', state());
    await page.waitForSelector('[role=tablist]');
    expect(await page.locator('[role=tab]').allTextContents()).toEqual(['overview', 'techniques', 'sources', 'limits'].map((id) => text('tab_' + id)));
    await page.close();
    page = await browser.newPage();
    await page.route('http://protect-ui.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await open('sidepanel', ACTIVE);
    await expect.poll(() => page.locator('[role=tab]').count()).toBe(6);
    expect((await page.locator('[role=tab]').allTextContents()).slice(4)).toEqual([text('tab_protect'), text('tab_history')]);
    await page.locator('#panel-tab-protect').click();
    expect(await page.locator('#panel-panel-protect').isVisible()).toBe(true);
    expect(await page.locator('#panel-protect-title').textContent()).toBe(text('protect_title'));
  });
});
