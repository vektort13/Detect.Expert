// Browser-only test entry. Never imported by a product entrypoint.
import { h, render } from 'preact';
import type { ReportProjection, ScopeState, UiRequest } from '@detect-expert/contracts';
import { PopupApp } from '../src/app/PopupApp';
import { SidepanelApp } from '../src/app/SidepanelApp';
import { OptionsApp } from '../src/app/OptionsApp';
import { useReportSession } from '../src/app/useReportSession';
import type { ReportSession } from '../src/app/useReportSession';
import type { UiSurface } from '../src/view-models/scope';
import { Notice } from '../src/components/Notice';
import { VendorsSection } from '../src/components/VendorsSection';
import { buildVendorCards } from '../src/view-models/cards';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
interface AuditHarness {
  report: ReportProjection | null;
  scope: ScopeState;
  requests: UiRequest[];
  delay: number;
  permission: boolean;
  hasPermission: boolean;
  permissionRequests: string[][];
  reloads: number[];
  failures: Record<string, string>;
  emptyAfterClear: boolean;
  tabUrl: string;
  session: ReportSession | null;
  mount(surface: UiSurface, table: Table, probe?: boolean): void;
  vendors(): void;
}
declare global { interface Window { uiAudit: AuditHarness } }

const root = document.createElement('div');
document.body.append(root);
let probeSurface: UiSurface = 'options';
function Probe() {
  const session = useReportSession({ surface: probeSurface, pollMs: 0 });
  window.uiAudit.session = session;
  return h(Notice, { notice: session.notice, onDismiss: session.dismissNotice });
}

const audit: AuditHarness = {
  report: null,
  scope: { scopeMode: 'off', hosts: [], managed: false, grantedAllSites: false },
  requests: [], delay: 0, permission: true, hasPermission: false, permissionRequests: [], reloads: [], failures: {}, session: null, emptyAfterClear: false, tabUrl: 'https://example.com/',
  mount(surface, table, probe = false) {
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      i18n: {
        getUILanguage: () => 'en',
        getMessage: (key: string, subs: string[] = []) => {
          const entry = table[key];
          if (!entry) return '';
          return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => {
            const index = Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1)) - 1;
            return subs[index] ?? '';
          });
        },
      },
      runtime: { sendMessage: async (request: UiRequest) => {
        audit.requests.push(request);
        if (audit.delay) await new Promise((resolve) => window.setTimeout(resolve, audit.delay));
        const code = audit.failures[request.type];
        if (code) return { schemaVersion: 1, type: 'error', code };
        switch (request.type) {
          case 'ui-get-report': return { schemaVersion: 1, type: 'report', report: audit.emptyAfterClear && audit.requests.some((r) => r.type === 'ui-clear') ? null : audit.report };
          case 'ui-get-scope': return { schemaVersion: 1, type: 'scope', scope: audit.scope };
          case 'ui-set-scope': audit.scope = { ...audit.scope, scopeMode: request.scopeMode }; break;
          case 'ui-pause': if (audit.report) audit.report = { ...audit.report, coverageState: 'paused' }; break;
          case 'ui-resume': if (audit.report) audit.report = { ...audit.report, coverageState: 'active' }; break;
          case 'ui-clear': if (audit.report) audit.report = { ...audit.report, techniques: [], findings: [] }; break;
          case 'ui-export-preview': return { schemaVersion: 1, type: 'export-preview', preview: {
            schemaVersion: 1, redacted: true, documentOrdinal: 1,
            reportRevision: audit.report?.reportRevision, report: { ...audit.report, host: request.includeHost ? audit.report?.host : null },
          } };
          default: break;
        }
        return { schemaVersion: 1, type: 'ok', reportRevision: audit.report?.reportRevision ?? null };
      } },
      tabs: { query: async () => [{ id: 12, url: audit.tabUrl }], reload: async (tabId: number) => { audit.reloads.push(tabId); }, onActivated: { addListener() {}, removeListener() {} } },
      permissions: { contains: async () => audit.hasPermission, request: async ({ origins }: { origins: string[] }) => { audit.permissionRequests.push(origins); return audit.permission; } },
    } });
    probeSurface = surface;
    render(h(probe ? Probe : surface === 'popup' ? PopupApp : surface === 'sidepanel' ? SidepanelApp : OptionsApp, {}), root);
  },
  vendors() {
    if (audit.report === null) throw new Error('Vendor harness requires a report');
    const vendors = buildVendorCards(audit.report);
    render(h('div', {}, h(VendorsSection, { id: 'first', catalogAvailable: true, vendors }), h(VendorsSection, { id: 'second', catalogAvailable: true, vendors })), root);
  },
};
window.uiAudit = audit;
