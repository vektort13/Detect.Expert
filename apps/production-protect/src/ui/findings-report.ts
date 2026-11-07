// ADR-052: value-free report reads have a deadline even if the SW never answers.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ProtectProjection } from '@detect-expert/contracts';
import { protectUi } from '../../../../vendor/protect-722fae8/packages/ui/src/messaging';

export const FINDINGS_REPORT_TIMEOUT_MS = 3000;

export function useFindingsReport(tabId: number, enabled: boolean): { report: ProtectProjection | null; loaded: boolean; refresh(): Promise<void> } {
  const [report, setReport] = useState<ProtectProjection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const target = useRef({ tabId, enabled, mounted: true, generation: 0 });
  const inflight = useRef<{ generation: number; request: number } | null>(null);
  const nextRequest = useRef(0);
  const accepted = useRef(-1);
  if (target.current.tabId !== tabId || target.current.enabled !== enabled) {
    target.current = { tabId, enabled, mounted: target.current.mounted, generation: target.current.generation + 1 };
  }
  const refresh = useCallback(async (): Promise<void> => {
    const generation = target.current.generation;
    if (inflight.current?.generation === generation || !target.current.enabled || !target.current.mounted) return;
    const requestedTab = target.current.tabId;
    const request = ++nextRequest.current;
    inflight.current = { generation, request };
    const current = (): boolean => target.current.mounted && target.current.enabled && target.current.generation === generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        protectUi.getReport(requestedTab),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), FINDINGS_REPORT_TIMEOUT_MS); }),
      ]);
      if (!current()) return;
      accepted.current = generation;
      setReport(answer !== null && answer.ok ? answer.response.report : null);
      setLoaded(true);
    } catch {
      if (current()) { accepted.current = generation; setReport(null); setLoaded(true); }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (inflight.current?.request === request) inflight.current = null;
    }
  }, []);
  useEffect(() => {
    target.current.mounted = true;
    return () => { target.current.mounted = false; target.current.generation++; };
  }, []);
  useEffect(() => {
    setReport(null);
    setLoaded(false);
    if (!enabled) return;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 1000);
    return () => { clearInterval(interval); };
  }, [tabId, enabled, refresh]);
  const fresh = accepted.current === target.current.generation;
  return { report: fresh ? report : null, loaded: fresh && loaded, refresh };
}
