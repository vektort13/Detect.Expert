// ADR-020 §D, §11 (S09): the firewall UI in real Chromium (DOM order, focus, dialogs) with a mocked privileged channel.
// Popup: the card's block order and truthful texts, the decision request (scope, receivers), the outcome with focus on
// its heading, undo back to the card, stale prompts, a rule that did not apply (+ SP-1 restart), warn-only and no
// permission («Понятно»), snooze, settings link, live region. Options: the mode (moved from the module section), the
// rule list (debounced search, filter, tri-state, removal confirmed with focus on «Отмена»), «Удалить все правила
// фаервола», #firewall; foundation follow-up: an organization-disabled user who never enabled the module sees no tabs.
// The harness is bundled from the string below (test-only); pages are served by page.route from memory.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { FW_DOC_KEY, FW_MULTI, FW_PROMPT_ID, FW_RECEIVER, FW_UNDO_ID, fwProjection, fwRuleRows, fwScenario, fwState } from './protect-firewall-support';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;

const HARNESS = String.raw`
import { h, render } from 'preact';
import { PRODUCTION_CATALOG } from '@detect-expert/catalog';
import { PopupApp } from '../src/app/PopupApp';
import { OptionsApp } from '../src/app/OptionsApp';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const harness = { state: null, report: null, after: null, decide: null, errors: {}, rules: [], requests: [], createdTabs: [] };
window.fwHarness = harness;

function stateAnswer() { return { schemaVersion: 1, type: 'protect-state', state: harness.state }; }
function rulesAnswer(request) {
  let rows = harness.rules;
  if (request.domainFilter) rows = rows.filter((r) => r.receiver.includes(request.domainFilter) || (r.site || '').includes(request.domainFilter));
  if (request.action) rows = rows.filter((r) => r.action === request.action);
  return { schemaVersion: 1, type: 'protect-rules', total: rows.length, rows: rows.slice(request.offset, request.offset + request.limit), preset: harness.state.preset, stoppedDays: [{ day: '2026-10-18', count: 4 }] };
}
function answer(request) {
  const code = harness.errors[request.type];
  if (code) return { schemaVersion: 1, type: 'error', code };
  switch (request.type) {
    case 'ui-get-scope': return { schemaVersion: 1, type: 'scope', scope: { scopeMode: 'site', hosts: ['shop.example'], grantedAllSites: true, managed: false } };
    case 'ui-get-report': return { schemaVersion: 1, type: 'report', report: null };
    case 'ui-protect-get-state': return stateAnswer();
    case 'ui-protect-get-report': return { schemaVersion: 1, type: 'protect-report', report: harness.report };
    case 'ui-protect-decide': {
      harness.saved = harness.report;
      harness.report = harness.after;
      return { schemaVersion: 1, type: 'protect-decision', applied: harness.decide.applied, undoId: harness.decide.undoId, report: null };
    }
    case 'ui-protect-undo': harness.report = harness.saved; return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
    case 'ui-protect-dismiss': harness.report = harness.after; return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
    case 'ui-protect-snooze':
      harness.state = { ...harness.state, snoozedUntil: request.minutes === 0 ? null : Date.now() + 3600000 };
      harness.report = { ...harness.report, firewall: { ...harness.report.firewall, snoozedUntil: harness.state.snoozedUntil, prompt: request.minutes === 0 ? harness.original.firewall.prompt : null } };
      return stateAnswer();
    case 'ui-protect-set-settings': harness.state = { ...harness.state, ...(request.preset ? { preset: request.preset } : {}) }; return stateAnswer();
    case 'ui-protect-list-rules': return rulesAnswer(request);
    case 'ui-protect-remove-rules': harness.rules = harness.rules.filter((r) => !request.ruleKeys.includes(r.ruleKey)); return rulesAnswer({ offset: 0, limit: 200 });
    case 'ui-protect-purge': harness.rules = []; harness.state = { ...harness.state, decisions: 0 }; return stateAnswer();
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
        harness.requests.push(JSON.parse(JSON.stringify(request)));
        await new Promise((r) => setTimeout(r, 5));
        return answer(request);
      },
    },
    permissions: { request: async () => true, remove: async () => true, getAll: async () => ({ origins: [], permissions: [] }), contains: async () => true, onAdded: noopEvent, onRemoved: noopEvent },
    tabs: {
      query: async () => [{ id: 12, url: 'https://shop.example/checkout' }],
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
  render(surface === 'popup' ? h(PopupApp, { catalog: PRODUCTION_CATALOG }) : h(OptionsApp, {}), root);
};
`;

interface HarnessView {
  requests: Array<Record<string, unknown>>;
  createdTabs: string[];
}

let browser: Browser;
let page: Page;
let script: string;
let css: string;

beforeAll(async () => {
  script = (await build({
    stdin: { contents: HARNESS, loader: 'tsx', resolveDir: resolve('packages/ui/test'), sourcefile: 'fw-ui-harness.tsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact',
  })).outputFiles[0]!.text;
  css = readFileSync(resolve('packages/ui/src/styles/ui.css'), 'utf8') + '\n' + readFileSync(resolve('packages/ui/src/styles/protect/base.css'), 'utf8') + '\n' + readFileSync(resolve('packages/ui/src/styles/protect/firewall.css'), 'utf8');
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
}, 30_000);
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 360, height: 600 } });
  await page.route('http://fw-ui.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>' }));
});
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser?.close(); });

interface OpenOptions {
  hash?: string;
  after?: ProtectProjection | null;
  decide?: { applied: Array<{ receiver: string; ruleApplied: boolean }>; undoId: string | null };
  errors?: Record<string, string>;
  rules?: unknown[];
}

async function open(surface: 'popup' | 'options', state: ProtectState, report: ProtectProjection | null, options: OpenOptions = {}): Promise<void> {
  await page.goto('http://fw-ui.test/' + surface + '.html' + (options.hash ?? ''));
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  const after = options.after === undefined ? (report === null ? null : { ...report, firewall: { ...report.firewall, prompt: null } }) : options.after;
  await page.evaluate(({ surface, state, report, after, decide, errors, rules, table }) => {
    const harness = (window as unknown as { fwHarness: Record<string, unknown> & { mount(s: string, t: unknown): void } }).fwHarness;
    Object.assign(harness, { state, report, original: report, after, decide, errors, rules });
    harness.mount(surface, table);
  }, { surface, state, report, after, decide: options.decide ?? { applied: [{ receiver: FW_RECEIVER, ruleApplied: true }], undoId: FW_UNDO_ID }, errors: options.errors ?? {}, rules: options.rules ?? [], table: ru });
}

const view = () => page.evaluate(() => {
  const h = (window as unknown as { fwHarness: HarnessView }).fwHarness;
  return { requests: [...h.requests], createdTabs: [...h.createdTabs] };
});
const sent = async (type: string) => (await view()).requests.filter((r) => r['type'] === type);
const text = (key: string, subs: string[] = []) => ru[key]!.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(ru[key]!.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
const focusedId = () => page.evaluate(() => document.activeElement?.id ?? '');
const cardText = () => page.locator('.fw-card').first().evaluate((el) => {
  // Rendered text without the footer (its lower-bound counter is not the state of a request).
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelector('.fw-foot')?.remove();
  document.body.append(clone);
  const out = clone.innerText;
  clone.remove();
  return out;
});

describe('popup firewall card', () => {
  it('sent: the blocks in the prototype order, accent primary button, no «остановлен», buttons in the first screen', async () => {
    const s = fwScenario('sent');
    await open('popup', s.state, s.report);
    await page.waitForSelector('[data-fw-card="sent"]');
    const order = await page.evaluate(() => [...document.querySelector('.fw-card')!.querySelectorAll('.fw-card__head, .fw-alert, .fw-note, .fw-chips, .fw-rows, .fw-evidence, .fw-receivers, .fw-scope, .fw-effect, .fw-decision, .fw-foot')].map((el) => el.className.split(' ').find((c) => c.startsWith('fw-'))));
    expect(order).toEqual(['fw-card__head', 'fw-alert', 'fw-note', 'fw-chips', 'fw-rows', 'fw-evidence', 'fw-scope', 'fw-effect', 'fw-decision', 'fw-foot']);
    // The card is the first thing of the module area, right after the header.
    expect(await page.evaluate(() => document.querySelector('[data-protect-area] .fw-card') !== null)).toBe(true);
    expect(await page.locator('#fw-card-title').textContent()).toBe(text('fw_card_title'));
    expect(await page.locator('.fw-alert').getAttribute('class')).toContain('state--attention');
    expect(await page.locator('.fw-alert').innerText()).toBe(text('fw_alert_sent_before_submit', [FW_RECEIVER, 'e-mail']));
    expect(await page.locator('.fw-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-fw-row')))).toEqual(['sender', 'company', 'receiver', 'data', 'moment']);
    expect(await page.locator('details.fw-evidence').getAttribute('open')).toBeNull();
    expect(await page.locator('.fw-scope input[type=radio]').count()).toBe(3);
    expect(await page.locator('.fw-scope input[value=site]').isChecked()).toBe(true);
    const block = page.locator('[data-fw-action=block]');
    expect(await block.getAttribute('class')).toContain('button--primary');
    expect(await block.textContent()).toBe(text('fw_action_block_next'));
    expect(await block.getAttribute('aria-describedby')).toBe('fw-rule-effect');
    expect(await page.locator('[data-fw-action=allow]').getAttribute('aria-describedby')).toBe('fw-allow-desc');
    expect(await page.locator('#fw-allow-desc').textContent()).toBe(text('fw_action_allow_desc'));
    const boxes = await page.locator('.fw-action').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ h: Math.round(r.height), w: Math.round(r.width), bottom: r.bottom })));
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.h >= 40 && b.bottom <= 600)).toBe(true);
    expect(Math.abs(boxes[0]!.w - boxes[1]!.w)).toBeLessThanOrEqual(1);
    expect((await cardText()).toLowerCase()).not.toContain('остановлен');
    expect(await page.locator('[data-fw-counter]').textContent()).toContain(text('fw_counter_today', ['3']));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  it('«Блокировать следующие» on this site: the decision request, the outcome focused, undo returns the card', async () => {
    const s = fwScenario('sent');
    await open('popup', s.state, s.report);
    await page.locator('[data-fw-action=block]').click();
    await page.waitForSelector('[data-fw-resolved]');
    expect(await sent('ui-protect-decide')).toEqual([{ schemaVersion: 1, type: 'ui-protect-decide', tabId: 12, documentKey: FW_DOC_KEY, protectRevision: 5, promptId: FW_PROMPT_ID, receivers: [FW_RECEIVER], action: 'block', scope: 'site' }]);
    expect(await focusedId()).toBe('fw-resolved-title');
    expect(await page.locator('#fw-resolved-title').textContent()).toBe(text('fw_resolved_blocked_title'));
    expect(await page.locator('[data-fw-resolved]').innerText()).toContain(text('fw_resolved_blocked_desc', [FW_RECEIVER]));
    await expect.poll(async () => (await sent('ui-protect-get-report')).length).toBeGreaterThanOrEqual(2);
    expect(await page.locator('[data-fw-card]').count()).toBe(0);
    await page.getByRole('button', { name: text('fw_action_undo') }).click();
    await page.waitForSelector('[data-fw-card="sent"]');
    expect(await sent('ui-protect-undo')).toEqual([{ schemaVersion: 1, type: 'ui-protect-undo', tabId: 12, undoId: FW_UNDO_ID }]);
    await expect.poll(focusedId).toBe('fw-card-title');
  });

  it('scope «Эта вкладка» and a receiver unticked are sent as chosen; «Разрешить» gives the allowed outcome', async () => {
    const s = fwScenario('multi');
    await open('popup', s.state, s.report, { decide: { applied: FW_MULTI.slice(1).map((r) => ({ receiver: r, ruleApplied: true })), undoId: FW_UNDO_ID } });
    await page.waitForSelector('[data-fw-receivers="3"]');
    expect(await page.locator('.fw-receivers input[type=checkbox]:checked').count()).toBe(3);
    await page.locator('#fw-receiver-0').uncheck();
    await page.locator('.fw-scope input[value=once]').check();
    expect(await page.locator('[data-fw-scope-desc]').textContent()).toBe(text('fw_scope_once_desc'));
    await page.locator('[data-fw-action=allow]').click();
    await page.waitForSelector('[data-fw-resolved]');
    const [request] = await sent('ui-protect-decide');
    expect(request).toMatchObject({ receivers: [FW_MULTI[1], FW_MULTI[2]], action: 'allow', scope: 'once' });
    expect(await page.locator('#fw-resolved-title').textContent()).toBe(text('fw_resolved_allowed_title'));
  });

  it('a stale prompt: fw_resolved_stale and a fresh projection, no outcome', async () => {
    const s = fwScenario('sent');
    await open('popup', s.state, s.report, { errors: { 'ui-protect-decide': 'stale-revision' } });
    const before = (await sent('ui-protect-get-report')).length;
    await page.locator('[data-fw-action=block]').click();
    await page.waitForSelector('[data-fw-message]');
    expect(await page.locator('[data-fw-message]').textContent()).toBe(text('fw_resolved_stale'));
    expect(await page.locator('[data-fw-resolved]').count()).toBe(0);
    expect((await sent('ui-protect-get-report')).length).toBeGreaterThan(before);
  });

  it('a rule that did not apply (SP-1): restart notice before, error outcome after — never «будут остановлены»', async () => {
    const s = fwScenario('resolved-error');
    await open('popup', s.state, s.report, { decide: s.decide! });
    await page.waitForSelector('[data-fw-blocking]');
    expect(await page.locator('[data-fw-blocking]').textContent()).toBe(text('fw_blocking_restart'));
    await page.locator('[data-fw-action=block]').click();
    await page.waitForSelector('[data-fw-resolved="error"]');
    expect(await page.locator('.fw-resolved__state').getAttribute('class')).toContain('state--error');
    expect(await page.locator('#fw-resolved-title').textContent()).toBe(text('fw_resolved_error', [FW_RECEIVER]));
    expect((await page.locator('[data-fw-resolved]').innerText()).toLowerCase()).not.toContain('будут остановлены');
  });

  it('stopped: neutral alert «остановлен правилом, которое действовало до этого запроса», «Оставить блокировку»', async () => {
    const s = fwScenario('stopped');
    await open('popup', s.state, s.report);
    await page.waitForSelector('[data-fw-card="stopped"]');
    expect(await page.locator('.fw-alert').getAttribute('class')).not.toContain('state--attention');
    expect(await page.locator('.fw-alert').innerText()).toBe(text('fw_alert_stopped', [FW_RECEIVER]));
    expect(await page.locator('[data-fw-action=block]').textContent()).toBe(text('fw_action_keep_blocked'));
  });

  it('unknown: neutral, «исход не наблюдался», no «уже отправлен», no «остановлен»', async () => {
    const s = fwScenario('unknown');
    await open('popup', s.state, s.report);
    await page.waitForSelector('[data-fw-card="unknown"]');
    const body = (await cardText()).toLowerCase();
    expect(body).toContain(text('fw_alert_unknown', [FW_RECEIVER, 'e-mail']).toLowerCase());
    expect(body).not.toContain('уже отправлен');
    expect(body).not.toContain('остановлен');
  });

  it('warn-only: only «Понятно» → dismiss, the outcome is focused; no permission: «Блокировка недоступна»', async () => {
    const s = fwScenario('warn-only');
    await open('popup', s.state, s.report);
    await page.waitForSelector('[data-fw-mode="ack"]');
    expect(await page.locator('[data-fw-action]').evaluateAll((els) => els.map((e) => e.getAttribute('data-fw-action')))).toEqual(['ack']);
    expect(await page.locator('.fw-scope').count()).toBe(0);
    await page.locator('[data-fw-action=ack]').click();
    await page.waitForSelector('[data-fw-resolved]');
    expect(await sent('ui-protect-dismiss')).toEqual([{ schemaVersion: 1, type: 'ui-protect-dismiss', tabId: 12, documentKey: FW_DOC_KEY, protectRevision: 5, promptId: FW_PROMPT_ID }]);
    expect(await focusedId()).toBe('fw-resolved-title');
    await page.close();
    page = await browser.newPage({ viewport: { width: 360, height: 600 } });
    await page.route('http://fw-ui.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>' }));
    await open('popup', fwState(), fwProjection({ firewall: { enforcement: 'no-permission' } }));
    await page.waitForSelector('[data-fw-mode="unavailable"]');
    expect(await page.locator('[data-fw-blocking]').textContent()).toBe(text('fw_blocking_unavailable'));
    expect(await page.locator('[data-fw-action]').count()).toBe(1);
  });

  it('«Не беспокоить 1 час» → snooze, the snoozed line (focused) with cancel; «Настройки фаервола» → options.html#firewall; live region', async () => {
    const s = fwScenario('multi');
    await open('popup', s.state, s.report);
    await page.waitForSelector('[data-fw-card]');
    await expect.poll(() => page.locator('[data-fw-live]').textContent(), { timeout: 4000 }).toBe(text('fw_live_pending', ['2']));
    await page.getByRole('button', { name: text('fw_action_settings') }).click();
    await expect.poll(async () => (await view()).createdTabs).toEqual(['chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html#firewall']);
    await page.getByRole('button', { name: text('protect_snooze') }).click();
    await page.waitForSelector('[data-fw-snoozed]');
    expect(await sent('ui-protect-snooze')).toEqual([{ schemaVersion: 1, type: 'ui-protect-snooze', minutes: 60 }]);
    expect(await page.locator('[data-fw-card]').count()).toBe(0);
    await expect.poll(focusedId).toBe('fw-snoozed');
    await page.getByRole('button', { name: text('protect_snooze_cancel') }).click();
    await expect.poll(async () => (await sent('ui-protect-snooze')).length).toBe(2);
    await page.waitForSelector('[data-fw-card]');
  }, 20_000);

  it('firewall feature off: no card even with a prompt', async () => {
    await open('popup', fwState({ features: ['value-match'] }), fwProjection());
    await page.waitForSelector('[data-protect-area]');
    await page.waitForTimeout(300);
    expect(await page.locator('[data-fw-root]').count()).toBe(0);
  });
});

describe('Options: firewall rules', () => {
  it('the mode moved here (module section has none); «Применить режим» sends the preset; strict carries its warning', async () => {
    await open('options', fwState(), null, { hash: '#firewall', rules: fwRuleRows(3) });
    await page.waitForSelector('[data-fw-rules="on"]');
    await expect.poll(focusedId).toBe('fw-rules-panel-title');
    expect(await page.locator('[data-protect-preset]').count()).toBe(0);
    expect(await page.locator('#fw-mode-strict').getAttribute('aria-describedby')).toBe('fw-mode-strict-warning');
    expect(await page.locator('#fw-mode-strict-warning').textContent()).toBe(text('fw_mode_strict_warning'));
    await page.locator('#fw-mode-strict').check();
    expect(await sent('ui-protect-set-settings')).toEqual([]);
    await page.locator('[data-fw-mode-apply]').click();
    await expect.poll(() => sent('ui-protect-set-settings')).toEqual([{ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }]);
    await expect.poll(() => page.locator('[data-fw-rules-message]').textContent()).toBe(text('fw_mode_applied'));
    expect(await page.locator('[data-fw-today]').innerText()).toContain(text('fw_today_title'));
  });

  it('search is debounced (300 ms) and normalized; invalid input sends nothing; the action filter', async () => {
    await open('options', fwState(), null, { hash: '#firewall', rules: fwRuleRows(6) });
    await page.waitForSelector('[data-fw-rule]');
    expect(await page.locator('[data-fw-rule]').count()).toBe(6);
    const before = (await sent('ui-protect-list-rules')).length;
    await page.locator('#fw-rules-search').fill('RCV1');
    await page.waitForTimeout(150);
    expect((await sent('ui-protect-list-rules')).length).toBe(before);
    await expect.poll(async () => (await sent('ui-protect-list-rules')).at(-1)?.['domainFilter']).toBe('rcv1');
    await expect.poll(() => page.locator('[data-fw-rule]').count()).toBe(1);
    const count = (await sent('ui-protect-list-rules')).length;
    await page.locator('#fw-rules-search').fill('a b');
    await page.waitForSelector('#fw-rules-search-invalid');
    expect((await sent('ui-protect-list-rules')).length).toBe(count);
    await page.locator('#fw-rules-search').fill('');
    await page.locator('#fw-rules-action').selectOption('allow');
    await expect.poll(async () => (await sent('ui-protect-list-rules')).at(-1)?.['action']).toBe('allow');
    await expect.poll(() => page.locator('[data-fw-rule]').evaluateAll((els) => els.every((e) => e.getAttribute('data-fw-rule-action') === 'allow'))).toBe(true);
  });

  it('tri-state select all, «Удалить выбранные (N)» confirmed (focus on «Отмена», Escape cancels), then removed', async () => {
    const rows = fwRuleRows(3);
    await open('options', fwState(), null, { hash: '#firewall', rules: rows });
    await page.waitForSelector('[data-fw-rule]');
    await page.locator('#fw-rule-0').check();
    await expect.poll(() => page.locator('#fw-rules-all').evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    await page.locator('#fw-rules-all').click();
    await expect.poll(() => page.locator('[data-fw-rule] input:checked').count()).toBe(3);
    await expect.poll(() => page.locator('#fw-rules-all').evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);
    await page.locator('[data-fw-remove-selected]').click();
    const dialog = page.getByRole('alertdialog');
    await expect.poll(() => dialog.count()).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(text('action_cancel'));
    expect(await dialog.locator('h2').textContent()).toBe(text('fw_rules_confirm_title', ['3']));
    await page.keyboard.press('Escape');
    await expect.poll(() => dialog.count()).toBe(0);
    expect(await sent('ui-protect-remove-rules')).toEqual([]);
    await page.locator('[data-fw-remove-selected]').click();
    await page.getByRole('alertdialog').getByRole('button', { name: text('fw_rules_remove_selected', ['3']) }).click();
    await expect.poll(() => sent('ui-protect-remove-rules')).toEqual([{ schemaVersion: 1, type: 'ui-protect-remove-rules', ruleKeys: rows.map((r) => r.ruleKey) }]);
    await expect.poll(() => page.locator('[data-fw-rules-empty]').textContent()).toBe(text('fw_rules_empty'));
    expect(await page.locator('[data-fw-rules-message]').textContent()).toBe(text('fw_rules_removed', ['3']));
  });

  it('«Удалить все правила фаервола» → confirm → ui-protect-purge decisions', async () => {
    await open('options', fwState(), null, { hash: '#firewall', rules: fwRuleRows(2) });
    await page.waitForSelector('[data-fw-rule]');
    await page.locator('[data-fw-clear-all]').click();
    await page.getByRole('alertdialog').getByRole('button', { name: text('fw_rules_clear_all') }).click();
    await expect.poll(() => sent('ui-protect-purge')).toEqual([{ schemaVersion: 1, type: 'ui-protect-purge', what: 'decisions' }]);
    await expect.poll(() => page.locator('[data-fw-rules-message]').textContent()).toBe(text('fw_rules_cleared'));
  });

  it('firewall feature off: the explanation, no list request', async () => {
    await open('options', fwState({ features: ['value-match'] }), null, { hash: '#firewall' });
    await page.waitForSelector('[data-fw-rules="off"]');
    expect(await page.locator('[data-fw-feature-off]').textContent()).toBe(text('fw_feature_off'));
    expect(await sent('ui-protect-list-rules')).toEqual([]);
  });

  it('follow-up: organization-disabled and never enabled → previous layout plus one section, no tabs', async () => {
    await open('options', fwState({ state: 'organization-disabled', organizationDisabled: true, consentVersion: null, features: [], decisions: 0 }), null, { hash: '#protect' });
    await page.waitForSelector('[data-protect-section="enable-only"]');
    expect(await page.locator('[role=tablist]').count()).toBe(0);
    expect(await page.locator('[data-fw-rules]').count()).toBe(0);
  });
});
