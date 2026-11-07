// Report session for popup / side panel / options: active tab, scope, report polling (1 s while visible),
// documentKey re-check before every action (navigation between click and handling), export preview flow,
// scope changes with chrome.permissions from the UI context (ADR-003 §4), proposed session clear.
// S12 / E13-03 (ADR-003 v3): granted site access (chrome.permissions.getAll, refreshed on onAdded/onRemoved), removing a
// site (ui-remove-site, then chrome.permissions.remove of its exact grants), revoking all sites, «Выключено» with revoke.
// S13 / E13-02: clear(expectedDocumentKey) deletes only the report the user confirmed (ConfirmDialog in ReportActions).

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ExportPreview, ReportProjection, ScopeMode, ScopeState, SensorId, UiRequest } from '@detect-expert/contracts';
import { sanitizeHost } from '@detect-expert/contracts';
import { triggerDownload } from '../download';
import { UI_CLEAR_SESSION_REQUEST, errorMessageKey, queryActiveTab, readGrantedAccess, removeOrigins, removeSiteRequest, sendUiRequest } from '../messaging';
import type { SendResult } from '../messaging';
import type { TabUrlClass, Tone } from '../view-models/coverage';
import { classifyTabUrl, detectChrome } from '../view-models/environment';
import type { ChromeSupport } from '../view-models/environment';
import { buildExportDownload, withExportHost } from '../view-models/export';
import { msg } from '../view-models/message';
import type { Message } from '../view-models/message';
import type { UiSurface } from '../view-models/scope';
import { permissionOriginsFor, scopeRequest } from '../view-models/scope';
import type { GrantedAccess } from '../view-models/site-access';
import { allSitesGranted, hostPatternsOf, offRevocableOf, revocableFor, siteAccessView, siteRemovedNoticeKey } from '../view-models/site-access';

export interface SessionNotice {
  message: Message;
  tone: Tone;
}

/** S12: «Выключено» may also revoke the optional site grants (default on in the picker, ADR-003 v3). */
export interface ScopeApplyOptions {
  revokeAccess?: boolean;
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
  /**
   * S13 (E13-02): deletes the report of `expectedDocumentKey` (the document shown when the confirmation opened). If the
   * shown or fresh document differs, nothing is sent and `coverage_context_changed` is shown.
   */
  clear(expectedDocumentKey: string): Promise<void>;
  reload(): Promise<void>;
  openExport(): Promise<void>;
  confirmExport(): Promise<void>;
  cancelExport(): void;
  applyScope(mode: ScopeMode, host: string | null, options?: ScopeApplyOptions): Promise<void>;
  /** S12: granted host patterns + required host_permissions; null until read or when the API is unavailable. */
  access: GrantedAccess | null;
  refreshAccess(): Promise<void>;
  /** S12 (options page): ui-remove-site, then revoke the host's exact optional grants. true when the SW accepted it. */
  removeSite(host: string): Promise<boolean>;
  /** S12 (options page): revoke the optional http/https all-sites grants. */
  revokeAllSites(): Promise<void>;
  /** S12: opens Chrome's page of this extension (site access settings); candidate on Chromium 153. */
  openChromeSiteAccess(): Promise<void>;
  /** ADR-019 (options page): disable or enable one sensor family. */
  applySensor(sensorId: SensorId, enabled: boolean): Promise<void>;
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
  const [access, setAccessState] = useState<GrantedAccess | null>(null);
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
  const scopeRef = useRef<ScopeState | null>(null);

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
      scopeRef.current = scopeResult.scope;
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

  const refreshAccess = useCallback(async (): Promise<void> => {
    const next = await readGrantedAccess();
    if (mountedRef.current) setAccessState(next);
  }, []);

  useEffect(() => {
    // S12: Chrome is the source of truth for grants; follow its permission events (also changes made elsewhere).
    void refreshAccess();
    const onPermissions = (): void => {
      void refreshAccess();
    };
    let listening = false;
    try {
      chrome.permissions.onAdded.addListener(onPermissions);
      chrome.permissions.onRemoved.addListener(onPermissions);
      listening = true;
    } catch {
      // permission events unavailable (static preview): the access list is read after each action instead
    }
    return () => {
      if (!listening) return;
      try {
        chrome.permissions.onAdded.removeListener(onPermissions);
        chrome.permissions.onRemoved.removeListener(onPermissions);
      } catch {
        // ignore
      }
    };
  }, [refreshAccess]);

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

  /**
   * Re-fetches the report and applies the action only when the shown document is still the current one (and, when
   * given, still the document the user confirmed the action for).
   */
  const guarded = useCallback(
    async (build: (fresh: ReportProjection, tabId: number) => UiRequest, expectedDocumentKey?: string): Promise<SendResult | null> => {
      const tabId = tabIdRef.current;
      const shown = reportRef.current;
      if (tabId === null || shown === null) return null;
      if (busyRef.current) return null;
      if (expectedDocumentKey !== undefined && shown.documentKey !== expectedDocumentKey) {
        setNotice({ message: msg('coverage_context_changed', hostMessage(shown)), tone: 'attention' });
        return null;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const { report: fresh } = await fetchReport(tabId);
        if (fresh === null || fresh.documentKey !== shown.documentKey || (expectedDocumentKey !== undefined && fresh.documentKey !== expectedDocumentKey)) {
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

  const clear = useCallback(async (expectedDocumentKey: string) => {
    const initiator = document.activeElement;
    const fallback = initiator?.closest('main')?.querySelector<HTMLElement>('.state__title');
    await guarded((fresh, tabId) => ({
      schemaVersion: 1,
      type: 'ui-clear',
      tabId,
      documentKey: fresh.documentKey,
      reportRevision: fresh.reportRevision,
    }), expectedDocumentKey);
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
    async (mode: ScopeMode, host: string | null, options: ScopeApplyOptions = {}) => {
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
        } else if (mode === 'off') {
          // S12 / ADR-003 v3: «Выключено» keeps Chrome's grants unless the user also revokes them (default on).
          const current = await readGrantedAccess();
          const revocable = offRevocableOf(current);
          if (options.revokeAccess === true && revocable.length > 0) {
            const removed = await removeOrigins(revocable);
            setNotice({ message: msg(removed ? 'scope_off_access_revoked' : 'access_revoke_failed'), tone: removed ? 'neutral' : 'attention' });
          } else if (revocable.length > 0) {
            setNotice({ message: msg('scope_off_access_kept'), tone: 'neutral' });
          } else {
            setNotice({ message: msg('scope_applied'), tone: 'neutral' });
          }
          setJustGranted(false);
          await refreshAccess();
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
    [refresh, refreshAccess, setNotice, surface],
  );

  const removeSite = useCallback(
    async (host: string): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await sendUiRequest(removeSiteRequest(host));
        if (!result.ok) {
          setNotice({ message: msg('scope_error', msg(errorMessageKey(result.code))), tone: result.code === 'unavailable' ? 'error' : 'attention' });
          await refresh();
          return false;
        }
        // The SW stopped observing the host; now revoke Chrome's exact grants of it (required ones stay).
        const before = await readGrantedAccess();
        const removed = await removeOrigins(before === null ? [] : revocableFor(host, before));
        const after = await readGrantedAccess();
        const grantRemains = after === null ? !removed : hostPatternsOf(host).some((p) => after.origins.includes(p));
        const key = siteRemovedNoticeKey(after !== null && allSitesGranted(after.origins), removed, grantRemains);
        setNotice({ message: msg(key, host), tone: key === 'site_removed' ? 'neutral' : 'attention' });
        if (mountedRef.current) setAccessState(after);
        await refresh();
        return true;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh, setNotice],
  );

  const revokeAllSites = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const current = await readGrantedAccess();
      const revocable = siteAccessView(scopeRef.current, current).allSites.revocable;
      const removed = revocable.length > 0 && (await removeOrigins(revocable));
      setNotice({ message: msg(removed ? 'all_sites_revoked' : 'access_revoke_failed'), tone: removed ? 'neutral' : 'attention' });
      await refreshAccess();
      await refresh();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh, refreshAccess, setNotice]);

  const openChromeSiteAccess = useCallback(async () => {
    try {
      // Candidate (Chromium 153): an extension page may open its own chrome://extensions details page.
      await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
    } catch {
      setNotice({ message: msg('error_not_implemented'), tone: 'attention' });
    }
  }, [setNotice]);

  const applySensor = useCallback(
    async (sensorId: SensorId, enabled: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await sendUiRequest({ schemaVersion: 1, type: 'ui-set-sensor', sensorId, enabled });
        if (result.ok) setNotice({ message: msg('options_sensors_applied'), tone: 'neutral' });
        else setNotice({ message: msg(errorMessageKey(result.code)), tone: result.code === 'unavailable' ? 'error' : 'attention' });
        await refresh();
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh, setNotice],
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
    access,
    refreshAccess,
    removeSite,
    revokeAllSites,
    openChromeSiteAccess,
    applySensor,
    clearSession,
    openSidePanel,
    openOptions,
    dismissNotice,
  };
}
