// Report session for popup / side panel / options: active tab, scope, report polling (1 s while visible),
// documentKey re-check before every action (navigation between click and handling), export preview flow,
// scope changes with chrome.permissions from the UI context (ADR-003 §4), proposed session clear.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ExportPreview, ReportProjection, ScopeMode, ScopeState, UiRequest } from '@detect-expert/contracts';
import { sanitizeHost } from '@detect-expert/contracts';
import { triggerDownload } from '../download';
import { UI_CLEAR_SESSION_REQUEST, errorMessageKey, queryActiveTab, sendUiRequest } from '../messaging';
import type { SendResult } from '../messaging';
import type { TabUrlClass, Tone } from '../view-models/coverage';
import { classifyTabUrl, detectChrome } from '../view-models/environment';
import type { ChromeSupport } from '../view-models/environment';
import { buildExportDownload, withExportHost } from '../view-models/export';
import { msg } from '../view-models/message';
import type { Message } from '../view-models/message';
import type { UiSurface } from '../view-models/scope';
import { permissionOriginsFor, scopeRequest } from '../view-models/scope';

export interface SessionNotice {
  message: Message;
  tone: Tone;
}

export interface SessionOptions {
  surface: UiSurface;
  /** 0 disables polling (options page). */
  pollMs?: number;
  /** Refresh on chrome.tabs.onActivated (side panel follows the active tab). */
  watchTabs?: boolean;
}

export interface ReportSession {
  tabId: number | null;
  tabUrlClass: TabUrlClass;
  /** Exact current host, held only in UI memory for an explicit site-permission choice. */
  scopeHost: string | null;
  report: ReportProjection | null;
  scope: ScopeState | null;
  swAvailable: boolean;
  chrome: ChromeSupport;
  loaded: boolean;
  busy: boolean;
  notice: SessionNotice | null;
  justGranted: boolean;
  preview: ExportPreview | null;
  exportHost: string | null;
  setExportHost(include: boolean): void;
  exportStatus: SessionNotice | null;
  refresh(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  clear(): Promise<void>;
  reload(): Promise<void>;
  openExport(): Promise<void>;
  confirmExport(): Promise<void>;
  cancelExport(): void;
  applyScope(mode: ScopeMode, host: string | null): Promise<void>;
  clearSession(): Promise<void>;
  openSidePanel(): Promise<void>;
  openOptions(): Promise<void>;
  dismissNotice(): void;
}

interface SessionState {
  tabId: number | null;
  tabUrlClass: TabUrlClass;
  scopeHost: string | null;
  report: ReportProjection | null;
  scope: ScopeState | null;
  swAvailable: boolean;
  loaded: boolean;
}

const INITIAL_STATE: SessionState = {
  tabId: null,
  tabUrlClass: 'unknown',
  scopeHost: null,
  report: null,
  scope: null,
  swAvailable: true,
  loaded: false,
};

async function fetchReport(tabId: number): Promise<{ report: ReportProjection | null; available: boolean }> {
  const result = await sendUiRequest({ schemaVersion: 1, type: 'ui-get-report', tabId });
  if (result.ok) return { report: result.response.type === 'report' ? result.response.report : null, available: true };
  return { report: null, available: result.code !== 'unavailable' };
}

async function fetchScope(): Promise<{ scope: ScopeState | null; available: boolean }> {
  const result = await sendUiRequest({ schemaVersion: 1, type: 'ui-get-scope' });
  if (result.ok) return { scope: result.response.type === 'scope' ? result.response.scope : null, available: true };
  return { scope: null, available: result.code !== 'unavailable' };
}

function hostMessage(report: ReportProjection | null): Message | string {
  return report?.host ?? msg('host_unknown');
}

export function useReportSession(options: SessionOptions): ReportSession {
  const surface = options.surface;
  const pollMs = options.pollMs ?? 1000;
  const watchTabs = options.watchTabs ?? false;

  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const [notice, setNoticeState] = useState<SessionNotice | null>(null);
  const [justGranted, setJustGranted] = useState(false);
  const [preview, setPreviewState] = useState<ExportPreview | null>(null);
  const [exportStatus, setExportStatus] = useState<SessionNotice | null>(null);
  const chromeSupport = useMemo(() => detectChrome(), []);

  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);
  const busyRef = useRef(false);
  const reportRef = useRef<ReportProjection | null>(null);
  const tabIdRef = useRef<number | null>(null);
  const tabUrlClassRef = useRef<TabUrlClass>('unknown');
  const previewRef = useRef<ExportPreview | null>(null);
  const sourcePreviewRef = useRef<ExportPreview | null>(null);
  const previewDocumentRef = useRef<string | null>(null);
  const transientHostRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  const setNotice = useCallback((next: SessionNotice | null) => {
    if (!mountedRef.current) return;
    // F057: action feedback stays available until dismissal or replacement.
    setNoticeState(next);
  }, []);

  const setPreview = useCallback((next: ExportPreview | null) => {
    if (next === null) sourcePreviewRef.current = null;
    previewRef.current = next;
    if (mountedRef.current) setPreviewState(next);
  }, []);

  const setExportHost = useCallback((include: boolean) => {
    const current = previewRef.current;
    const documentKey = previewDocumentRef.current;
    const tabId = tabIdRef.current;
    if (busyRef.current || current === null || documentKey === null || tabId === null) return;
    if (!include) { setPreview(withExportHost(current)); return; }
    busyRef.current = true;
    setBusy(true);
    void sendUiRequest({ schemaVersion: 1, type: 'ui-export-preview', tabId, documentKey,
      reportRevision: current.reportRevision, includeHost: true }).then((result) => {
      if (previewRef.current !== current) return;
      if (result.ok && result.response.type === 'export-preview') setPreview(result.response.preview);
      else if (!result.ok) setNotice({ message: msg(errorMessageKey(result.code)), tone: 'attention' });
    }).finally(() => { busyRef.current = false; if (mountedRef.current) setBusy(false); });
  }, [setPreview, setNotice]);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const tab = await queryActiveTab();
      const scopeHost = classifyTabUrl(tab.url) === 'web' && tab.url !== undefined ? sanitizeHost(tab.url) : null;
      transientHostRef.current = scopeHost;
      const scopeResult = await fetchScope();
      let available = scopeResult.available;
      let report: ReportProjection | null = null;
      if (available && tab.id !== null) {
        const reportResult = await fetchReport(tab.id);
        report = reportResult.report;
        available = reportResult.available;
      }
      if (!mountedRef.current) return;
      const previousKey = lastKeyRef.current;
      if (report !== null && previousKey !== null && report.documentKey !== previousKey) {
        // Explicit document change: never mix old cards with the new host (spec VI I5).
        setNotice({ message: msg('coverage_context_changed', hostMessage(report)), tone: 'attention' });
        setJustGranted(false);
        setPreview(null);
      }
      lastKeyRef.current = report === null ? null : report.documentKey;
      reportRef.current = report;
      tabIdRef.current = tab.id;
      tabUrlClassRef.current = classifyTabUrl(tab.url);
      setState({
        tabId: tab.id,
        tabUrlClass: classifyTabUrl(tab.url),
        scopeHost,
        report,
        scope: scopeResult.scope,
        swAvailable: available,
        loaded: true,
      });
    } finally {
      refreshingRef.current = false;
    }
  }, [setNotice, setPreview]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const onActivated = (): void => {
      void refresh();
    };
    const tick = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh();
    };
    let intervalId: number | null = null;
    if (pollMs > 0) {
      intervalId = window.setInterval(tick, pollMs);
      document.addEventListener('visibilitychange', tick);
    }
    if (watchTabs) {
      try {
        chrome.tabs.onActivated.addListener(onActivated);
      } catch {
        // tabs events unavailable: polling still covers tab switches
      }
    }
    return () => {
      mountedRef.current = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', tick);
      }
      if (watchTabs) {
        try {
          chrome.tabs.onActivated.removeListener(onActivated);
        } catch {
          // ignore
        }
      }
    };
  }, [pollMs, watchTabs, refresh]);

  /** Re-fetches the report and applies the action only when the shown document is still the current one. */
  const guarded = useCallback(
    async (build: (fresh: ReportProjection, tabId: number) => UiRequest): Promise<SendResult | null> => {
      const tabId = tabIdRef.current;
      const shown = reportRef.current;
      if (tabId === null || shown === null) return null;
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        const { report: fresh } = await fetchReport(tabId);
        if (fresh === null || fresh.documentKey !== shown.documentKey) {
          setNotice({ message: msg('coverage_context_changed', hostMessage(fresh)), tone: 'attention' });
          await refresh();
          return null;
        }
        const result = await sendUiRequest(build(fresh, tabId));
        if (!result.ok) {
          setNotice({ message: msg(errorMessageKey(result.code)), tone: result.code === 'unavailable' ? 'error' : 'attention' });
        }
        await refresh();
        return result;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh, setNotice],
  );

  const pause = useCallback(async () => {
    await guarded((fresh, tabId) => ({
      schemaVersion: 1,
      type: 'ui-pause',
      tabId,
      documentKey: fresh.documentKey,
      reportRevision: fresh.reportRevision,
    }));
  }, [guarded]);

  const resume = useCallback(async () => {
    await guarded((fresh, tabId) => ({ schemaVersion: 1, type: 'ui-resume', tabId, documentKey: fresh.documentKey, reportRevision: fresh.reportRevision }));
  }, [guarded]);

  const clear = useCallback(async () => {
    const initiator = document.activeElement;
    const fallback = initiator?.closest('main')?.querySelector<HTMLElement>('.state__title');
    await guarded((fresh, tabId) => ({
      schemaVersion: 1,
      type: 'ui-clear',
      tabId,
      documentKey: fresh.documentKey,
      reportRevision: fresh.reportRevision,
    }));
    // F058: a deleted report can remove its controls entirely. Keep keyboard context at coverage.
    window.requestAnimationFrame(() => {
      if (initiator !== null && !initiator.isConnected && document.activeElement === document.body && fallback?.isConnected) fallback.focus();
    });
  }, [guarded]);

  const reload = useCallback(async () => {
    const tabId = tabIdRef.current;
    if (tabId === null || busyRef.current) return;
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      // restricted tab or closed tab: nothing to reload
    }
    setJustGranted(false);
    await refresh();
  }, [refresh]);

  const openExport = useCallback(async () => {
    if (busyRef.current) return;
    setExportStatus(null);
    previewDocumentRef.current = reportRef.current?.documentKey ?? null;
    const result = await guarded((fresh, tabId) => ({
      schemaVersion: 1,
      type: 'ui-export-preview',
      tabId,
      documentKey: fresh.documentKey,
      reportRevision: fresh.reportRevision,
    }));
    if (result === null) return;
    if (result.ok && result.response.type === 'export-preview') {
      sourcePreviewRef.current = result.response.preview;
      setPreview(withExportHost(result.response.preview));
    } else if (!result.ok && result.code === 'not-implemented') {
      setNotice({ message: msg('export_not_implemented'), tone: 'attention' });
    }
  }, [guarded, setNotice, setPreview]);

  const confirmExport = useCallback(async () => {
    const current = previewRef.current;
    const tabId = tabIdRef.current;
    if (current === null || tabId === null) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { report: fresh } = await fetchReport(tabId);
      // Cancel/Escape or a context refresh may have invalidated this pending confirmation.
      if (previewRef.current !== current) return;
      if (fresh === null || fresh.documentKey !== previewDocumentRef.current) {
        // The document changed between preview and save: refuse, explain, rebuild on demand (E14-01 case 4).
        setPreview(null);
        const changed: SessionNotice = { message: msg('export_document_changed'), tone: 'attention' };
        setExportStatus(changed);
        await refresh();
        setNotice(changed);
        return;
      }
      triggerDownload(buildExportDownload(current));
      setPreview(null);
      setExportStatus(null);
      setNotice({ message: msg('export_saved'), tone: 'neutral' });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh, setNotice, setPreview]);

  const cancelExport = useCallback(() => {
    setPreview(null);
    setExportStatus(null);
  }, [setPreview]);

  const applyScope = useCallback(
    async (mode: ScopeMode, host: string | null) => {
      if (busyRef.current) return;
      // F053 / ADR-003: side-panel and options gestures do not grant activeTab.
      if (mode === 'active-tab' && surface !== 'popup') {
        setNotice({ message: msg('scope_active_tab_toolbar'), tone: 'attention' });
        return;
      }
      if (mode === 'active-tab' && (tabIdRef.current === null || tabUrlClassRef.current === 'restricted')) {
        setNotice({ message: msg('error_no_access'), tone: 'attention' });
        return;
      }
      host = host ?? transientHostRef.current;
      const request = scopeRequest(mode, host);
      if (request === null) {
        setNotice({ message: msg('scope_site_host_unknown'), tone: 'attention' });
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const origins = permissionOriginsFor(mode, host);
        let granted = false;
        if (origins !== null) {
          let has = false;
          try {
            has = mode === 'site'
              ? (await Promise.all(origins.map((origin) => chrome.permissions.contains({ origins: [origin] })))).some(Boolean)
              : await chrome.permissions.contains({ origins });
          } catch {
            has = false;
          }
          if (!has) {
            let ok = false;
            try {
              ok = await chrome.permissions.request({ origins });
            } catch {
              ok = false;
            }
            if (!ok) {
              setNotice({ message: msg('scope_permission_denied'), tone: 'attention' });
              return;
            }
            granted = true;
          }
        }
        const result = await sendUiRequest(mode === 'active-tab' && tabIdRef.current !== null
          ? { schemaVersion: 1, type: 'ui-inject-now', tabId: tabIdRef.current } : request);
        if (!result.ok) {
          setNotice({ message: msg('scope_error', msg(errorMessageKey(result.code))), tone: result.code === 'unavailable' ? 'error' : 'attention' });
        } else {
          const needsReload = mode === 'site' || mode === 'all-sites';
          setNotice({ message: msg(granted ? 'scope_permission_granted_reload' : needsReload ? 'scope_applied_reload' : 'scope_applied'), tone: 'neutral' });
          setJustGranted(needsReload);
        }
        await refresh();
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh, setNotice, surface],
  );

  const clearSession = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await sendUiRequest(UI_CLEAR_SESSION_REQUEST);
      if (result.ok) {
        setNotice({ message: msg('options_clear_done'), tone: 'neutral' });
      } else if (result.code === 'invalid-request' || result.code === 'not-implemented') {
        setNotice({ message: msg('options_clear_unavailable'), tone: 'attention' });
      } else {
        setNotice({ message: msg(errorMessageKey(result.code)), tone: result.code === 'unavailable' ? 'error' : 'attention' });
      }
      await refresh();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh, setNotice]);

  const openSidePanel = useCallback(async () => {
    const tabId = tabIdRef.current;
    if (tabId === null) return;
    try {
      await chrome.sidePanel.open({ tabId });
      window.close();
    } catch {
      setNotice({ message: msg('error_not_implemented'), tone: 'attention' });
    }
  }, [setNotice]);

  const openOptions = useCallback(async () => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      // options page unavailable in this context
    }
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), [setNotice]);

  return {
    tabId: state.tabId,
    tabUrlClass: state.tabUrlClass,
    scopeHost: state.scopeHost,
    report: state.report,
    scope: state.scope,
    swAvailable: state.swAvailable,
    chrome: chromeSupport,
    loaded: state.loaded,
    busy,
    notice,
    justGranted,
    preview,
    exportHost: reportRef.current?.host ?? null,
    setExportHost,
    exportStatus,
    refresh,
    pause,
    resume,
    clear,
    reload,
    openExport,
    confirmExport,
    cancelExport,
    applyScope,
    clearSession,
    openSidePanel,
    openOptions,
    dismissNotice,
  };
}
