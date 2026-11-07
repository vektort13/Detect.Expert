// ADR-020 «Защита» (S06): the module's projection of the shown tab (`ui-protect-get-report`). Requested only while the
// module is not off (`enabled`); in the popup and the side panel it follows the existing one-second poll while the
// page is visible. Nothing is stored: the projection lives in page memory only.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ProtectProjection } from '@detect-expert/contracts';
import { protectUi } from '../messaging';

export interface ProtectReportSession {
  report: ProtectProjection | null;
  /** At least one answer arrived for the current tab. */
  loaded: boolean;
  refresh(): Promise<void>;
}

export function useProtectReport(tabId: number | null, enabled: boolean, pollMs = 1000): ProtectReportSession {
  const [report, setReport] = useState<ProtectProjection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inflightRef = useRef(false);
  const targetRef = useRef<{ tabId: number | null; enabled: boolean }>({ tabId, enabled });
  targetRef.current = { tabId, enabled };

  const refresh = useCallback(async (): Promise<void> => {
    const { tabId: tab, enabled: on } = targetRef.current;
    if (!on || tab === null || inflightRef.current) return;
    inflightRef.current = true;
    try {
      const result = await protectUi.getReport(tab);
      // The tab or the module state changed meanwhile: this answer is not for the shown document.
      if (targetRef.current.tabId !== tab || !targetRef.current.enabled) return;
      setReport(result.ok ? result.response.report : null);
      setLoaded(true);
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    setReport(null);
    setLoaded(false);
    if (!enabled || tabId === null) return;
    void refresh();
    if (pollMs <= 0) return;
    const tick = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh();
    };
    const intervalId = window.setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [tabId, enabled, pollMs, refresh]);

  return { report, loaded, refresh };
}
