// ADR-020 §D (S09): fixed service-worker replies for the firewall UI specs (firewall-popup-*.spec.ts,
// firewall-options.spec.ts). Injected by Playwright only into dist/test extension pages opened with `?fwfixture=1`;
// nothing here is bundled into the extension. The builders come from packages/ui/test/protect-firewall-support.ts
// (synthetic domains; no value, hash, URL or query). The real-SW path is covered by firewall-popup-badge.spec.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { extensionIdOf, getServiceWorker, repoRoot, type ExtensionSession } from '../harness';

export type LocaleTable = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
export const ru = JSON.parse(readFileSync(path.join(repoRoot, 'apps/extension/_locales/ru/messages.json'), 'utf8')) as LocaleTable;

export function text(key: string, subs: string[] = []): string {
  const entry = ru[key];
  if (entry === undefined) throw new Error('missing locale key ' + key);
  return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '');
}

export interface FwFixtureData {
  state: ProtectState;
  /** Reports answered in turn to ui-protect-get-report (the last one repeats). */
  reports: ProtectProjection[];
  /** Report after a decision / dismissal (default: the current one without a prompt). */
  after?: ProtectProjection | null;
  decide?: { applied: Array<{ receiver: string; ruleApplied: boolean }>; undoId: string | null };
  errors?: Record<string, string>;
  rules?: unknown[];
}

export interface FwFixtureLog {
  requests: Array<Record<string, unknown>>;
  createdTabs: string[];
}

/**
 * Opens popup.html or options.html of dist/test with fixed replies. `hash` for options (#firewall). The page answers
 * observation requests (scope site, no observation report) and the module's requests from `data`.
 */
export async function fwFixturePage(ext: ExtensionSession, surface: 'popup' | 'options', data: FwFixtureData, options: { width?: number; height?: number; hash?: string } = {}): Promise<Page> {
  if (ext.dist !== path.join(repoRoot, 'dist', 'test')) throw new Error('S09 fixtures require dist/test');
  const sw = await getServiceWorker(ext.context);
  const page = await ext.context.newPage();
  await page.setViewportSize({ width: options.width ?? 360, height: options.height ?? 600 });
  await page.addInitScript(({ data, messages }) => {
    if (location.protocol !== 'chrome-extension:' || new URLSearchParams(location.search).get('fwfixture') !== '1') return;
    const log = { requests: [] as Array<Record<string, unknown>>, createdTabs: [] as string[] };
    (window as unknown as { __fw: unknown }).__fw = log;
    let state = data.state;
    let index = 0;
    let current = data.reports[0] ?? null;
    let saved: unknown = null;
    let rules = (data.rules ?? []) as Array<Record<string, unknown>>;
    const nextReport = (): unknown => {
      if (current === null || data.reports.length <= 1) return current;
      const r = data.reports[Math.min(index, data.reports.length - 1)]!;
      index++;
      current = r;
      return r;
    };
    const withoutPrompt = (r: unknown): unknown => (r === null ? null : { ...(r as Record<string, unknown>), firewall: { ...((r as { firewall: object }).firewall), prompt: null } });
    const rulesAnswer = (request: Record<string, unknown>): unknown => {
      let rows = rules;
      const filter = request['domainFilter'];
      if (typeof filter === 'string') rows = rows.filter((r) => String(r['receiver']).includes(filter) || String(r['site'] ?? '').includes(filter));
      if (request['action'] !== undefined) rows = rows.filter((r) => r['action'] === request['action']);
      const offset = Number(request['offset'] ?? 0);
      const limit = Number(request['limit'] ?? 200);
      return { schemaVersion: 1, type: 'protect-rules', total: rows.length, rows: rows.slice(offset, offset + limit), preset: state.preset, stoppedDays: [{ day: '2026-10-18', count: 4 }] };
    };
    const answer = (request: Record<string, unknown>): unknown => {
      const code = data.errors?.[String(request['type'])];
      if (code !== undefined) return { schemaVersion: 1, type: 'error', code };
      switch (request['type']) {
        case 'ui-get-scope': return { schemaVersion: 1, type: 'scope', scope: { scopeMode: 'site', hosts: ['shop.example'], grantedAllSites: true, managed: false } };
        case 'ui-get-report': return { schemaVersion: 1, type: 'report', report: null };
        case 'ui-protect-get-state': return { schemaVersion: 1, type: 'protect-state', state };
        case 'ui-protect-get-report': return { schemaVersion: 1, type: 'protect-report', report: nextReport() };
        case 'ui-protect-decide':
          saved = current;
          current = (data.after === undefined ? withoutPrompt(current) : data.after) as typeof current;
          return { schemaVersion: 1, type: 'protect-decision', applied: data.decide?.applied ?? [], undoId: data.decide?.undoId ?? null, report: null };
        case 'ui-protect-undo': current = saved as typeof current; return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
        case 'ui-protect-dismiss': current = withoutPrompt(current) as typeof current; return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
        case 'ui-protect-snooze': {
          const until = request['minutes'] === 0 ? null : Date.now() + 3_600_000;
          state = { ...state, snoozedUntil: until };
          if (current !== null) current = { ...current, firewall: { ...current.firewall, snoozedUntil: until, prompt: until === null ? (data.reports[0]?.firewall.prompt ?? null) : null } };
          return { schemaVersion: 1, type: 'protect-state', state };
        }
        case 'ui-protect-set-settings': state = { ...state, ...(typeof request['preset'] === 'string' ? { preset: request['preset'] as ProtectState['preset'] } : {}) }; return { schemaVersion: 1, type: 'protect-state', state };
        case 'ui-protect-list-rules': return rulesAnswer(request);
        case 'ui-protect-remove-rules': {
          const keys = request['ruleKeys'] as string[];
          rules = rules.filter((r) => !keys.includes(String(r['ruleKey'])));
          return rulesAnswer({ offset: 0, limit: 200 });
        }
        case 'ui-protect-purge': rules = []; state = { ...state, decisions: 0 }; return { schemaVersion: 1, type: 'protect-state', state };
        default: return { schemaVersion: 1, type: 'ok', reportRevision: null };
      }
    };
    chrome.tabs.query = (async () => [{ id: 12, url: 'https://shop.example/checkout' }]) as unknown as typeof chrome.tabs.query;
    chrome.tabs.create = (async (props: { url?: string }) => {
      log.createdTabs.push(String(props.url));
      return { id: 99 };
    }) as unknown as typeof chrome.tabs.create;
    chrome.runtime.sendMessage = (async (request: Record<string, unknown>) => {
      log.requests.push(JSON.parse(JSON.stringify(request)) as Record<string, unknown>);
      return answer(request);
    }) as unknown as typeof chrome.runtime.sendMessage;
    chrome.i18n.getUILanguage = () => 'ru';
    chrome.i18n.getMessage = ((key: string, subs: string[] = []) => {
      const entry = messages[key];
      return entry?.message.replace(/\$([A-Z_]+)\$/gi, (_: string, name: string) => subs[Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1] ?? '') ?? '';
    }) as typeof chrome.i18n.getMessage;
  }, { data, messages: ru });
  await page.goto('chrome-extension://' + extensionIdOf(sw) + '/' + surface + '.html?fwfixture=1' + (options.hash ?? ''));
  if (surface === 'popup') await expect(page.locator('#coverage-title')).toBeVisible();
  else await expect(page.locator('main')).toBeVisible();
  return page;
}

export async function fwLog(page: Page): Promise<FwFixtureLog> {
  return page.evaluate(() => {
    const log = (window as unknown as { __fw: FwFixtureLog }).__fw;
    return { requests: [...log.requests], createdTabs: [...log.createdTabs] };
  });
}

export async function fwRequests(page: Page, type: string): Promise<Array<Record<string, unknown>>> {
  return (await fwLog(page)).requests.filter((r) => r['type'] === type);
}

/** Forbidden wording of docs/ui-copy.md §8 (every «…» phrase, including the module line) plus the brief's list. */
export function forbiddenPhrases(): string[] {
  const section = readFileSync(path.join(repoRoot, 'docs/ui-copy.md'), 'utf8').split('## 8.')[1]!.split('## 9.')[0]!;
  const quoted = [...section.matchAll(/«([^»]+)»/g)].map((m) => m[1]!.toLowerCase());
  return [...new Set([...quoted, 'придерж', 'пытается отправ', 'не получит', 'утечк', 'вы защищ'])];
}

/**
 * Text of the firewall card without its footer (the lower-bound counter «Остановлено правилами сегодня» is not the
 * state of a request).
 */
export async function cardStateText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const card = document.querySelector('.fw-card');
    if (card === null) return '';
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelector('.fw-foot')?.remove();
    document.body.append(clone);
    const out = clone.innerText;
    clone.remove();
    return out.toLowerCase();
  });
}
