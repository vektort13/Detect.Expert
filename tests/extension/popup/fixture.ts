// P08 / REQ-006: fixed background replies, injected by Playwright only into dist/test pages.
// Nothing in this file is bundled into the extension. Real-SW performance uses no reply hook.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CoverageState, UiRequest, ReportProjection, ExportPreview } from '@detect-expert/contracts';
import { extensionIdOf, getServiceWorker, repoRoot, type ExtensionSession } from '../harness';

export const states = ['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded', 'restricted', 'off', 'loading', 'empty'] as const;
export type State = typeof states[number];
export type LocaleTable = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
export const messages = JSON.parse(readFileSync(path.join(repoRoot, 'apps/extension/_locales/ru/messages.json'), 'utf8')) as LocaleTable;

export async function fixturePage(ext: ExtensionSession, state: State, surface = 'popup', width = 360): Promise<Page> {
  if (ext.dist !== path.join(repoRoot, 'dist', 'test')) throw new Error('P08 fixtures require dist/test');
  const sw = await getServiceWorker(ext.context);
  const page = await ext.context.newPage();
  await page.setViewportSize({ width, height: 800 });
  const rep: ReportProjection = {
    reportRevision: 7, documentKey: '12:0:doc-a', host: 'example.com',
    observedSince: 1_700_000_000_000, scopeMode: 'site', vendors: [],
    dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 },
    coverageState: states.slice(0, 7).includes(state as CoverageState) ? state as CoverageState : 'active',
    techniques: state === 'empty' ? [] : [{ techniqueId: 'DET-002', count: 3, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use'], evidenceSource: 'page-hook', integrity: 'page-controlled', interpretation: 'api-use', interpretationConfidence: 'unassessed', attributionConfidence: 'unknown', firstBucket: 1, lastBucket: 4 }],
    findings: state === 'empty' ? [] : [{ findingId: 'p08', techniqueId: 'DET-002', ruleId: 'rule-canvas-sequence', ruleVersion: '2', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', evidenceIds: [], counterEvidenceCodes: ['image-editor'], limitationCodes: ['page-controlled-data'], vendorMatchIds: [] }],
    coverageFlags: state === 'degraded' ? ['channel-gap'] : state === 'partial' ? ['frames-inaccessible'] : [],
  };
  const exportPreview: ExportPreview = { schemaVersion: 1, redacted: true, documentOrdinal: 1, reportRevision: 7,
    report: { host: null, coverageState: rep.coverageState, coverageFlags: rep.coverageFlags, techniques: rep.techniques, findings: rep.findings, vendors: [], dropped: rep.dropped, observationAgeMinutes: 1, scopeMode: 'site' } };
  await page.addInitScript(({ state, rep, messages, exportPreview }) => {
    if (location.protocol !== 'chrome-extension:' || new URLSearchParams(location.search).get('fixture') !== state) return;
    chrome.tabs.query = (async () => [{ id: 12, url: state === 'restricted' ? 'chrome://settings/' : 'https://example.com/' }]) as unknown as typeof chrome.tabs.query;
    chrome.runtime.sendMessage = (async (request: UiRequest) => {
      if (state === 'loading') return new Promise(() => {});
      if (request.type === 'ui-get-scope') return { schemaVersion: 1, type: 'scope', scope: { scopeMode: state === 'off' ? 'off' : 'site', hosts: ['example.com'], grantedAllSites: false, managed: false } };
      if (request.type === 'ui-get-report') return { schemaVersion: 1, type: 'report', report: state === 'restricted' || state === 'off' ? null : rep };
      if (request.type === 'ui-export-preview') return { schemaVersion: 1, type: 'export-preview', preview: exportPreview };
      throw new Error('Unexpected fixture action: ' + request.type);
    }) as typeof chrome.runtime.sendMessage;
    chrome.i18n.getUILanguage = () => 'ru';
    chrome.i18n.getMessage = ((key: string, subs: string[] = []) => {
      const entry = messages[key];
      return entry?.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => {
        const content = entry.placeholders?.[name.toLowerCase()]?.content ?? '';
        return subs[Number(content.slice(1)) - 1] ?? '';
      }) ?? '';
    }) as typeof chrome.i18n.getMessage;
  }, { state, rep, messages, exportPreview });
  await page.goto('chrome-extension://' + extensionIdOf(sw) + '/' + surface + '.html?fixture=' + state);
  const id = surface === 'popup' ? '#coverage-title' : '#panel-coverage-title';
  const key = state === 'loading' ? 'statusLoading' : state === 'restricted' ? 'coverage_unsupported_title' : state === 'off' ? 'state_scope_off_title' : 'coverage_' + (state === 'empty' ? 'active' : state.replace(/-/g, '_')) + '_title';
  // Assert the actual state, not merely a mounted shell.
  await expect(page.locator(id)).toHaveText(messages[key]?.message ?? key);
  return page;
}
