// ADR-058: the action popup can temporarily own native window focus. Wait for the
// captured source to regain it; never move the notification to another document.
import type { OverlayTarget } from './overlay-controller';

export const ACTIVATION_FOCUS_TIMEOUT_MS = 5000;
const NATIVE_TIMEOUT_MS = 500;
const POLL_MS = 100;
interface ActivationFocusApi {
  tabs: { get(tabId: number): Promise<{ id?: number | undefined; windowId?: number | undefined; active?: boolean | undefined; pendingUrl?: string | undefined }> };
  windows: { get(windowId: number): Promise<{ type?: string | undefined; focused?: boolean | undefined }> };
  webNavigation: { getFrame(details: { tabId: number; frameId: 0 }): Promise<{ documentId?: string | undefined; errorOccurred?: boolean | undefined; documentLifecycle?: string | undefined } | null> };
}

/** A cosmetic notification may be omitted, but never delivered after a source switch or OFF. */
export async function waitForActivationFocus(
  target: OverlayTarget & { windowId: number },
  eligible: () => boolean,
  api: ActivationFocusApi = chrome,
): Promise<boolean> {
  const deadline = Date.now() + ACTIVATION_FOCUS_TIMEOUT_MS;
  const allowed = () => { try { return eligible() === true; } catch { return false; } };
  while (allowed() && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reads = Promise.all([
        api.tabs.get(target.tabId), api.windows.get(target.windowId),
        api.webNavigation.getFrame({ tabId: target.tabId, frameId: 0 }),
      ] as const);
      const result = await Promise.race([
        reads,
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.min(NATIVE_TIMEOUT_MS, deadline - Date.now())); }),
      ]);
      if (!result || !allowed() || Date.now() >= deadline) return false;
      const [tab, window, frame] = result;
      if (tab.id !== target.tabId || tab.windowId !== target.windowId || tab.active !== true || tab.pendingUrl ||
          window.type !== 'normal' || !frame || frame.documentId !== target.documentId || frame.errorOccurred === true ||
          frame.documentLifecycle !== undefined && frame.documentLifecycle !== 'active') return false;
      if (window.focused === true) return true;
    } catch { return false; }
    finally { if (timer !== undefined) clearTimeout(timer); }
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
  }
  return false;
}
