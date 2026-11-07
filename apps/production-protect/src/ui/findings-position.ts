// ADR-052: outer window coordinates, including negative monitor origins.
export interface FindingsWorkArea { left: number; top: number; width: number; height: number }
export interface FindingsWindowBounds { left: number; top: number; width: number; height: number }

export function findingsWindowBounds(area: FindingsWorkArea, requestedHeight = 760): FindingsWindowBounds | null {
  if (![area.left, area.top, area.width, area.height].every(Number.isFinite) || area.width < 1 || area.height < 1) return null;
  const left = Math.ceil(area.left), top = Math.ceil(area.top);
  const availableWidth = Math.floor(area.width), availableHeight = Math.floor(area.height);
  const margin = Math.min(16, Math.floor(availableWidth / 4), Math.floor(availableHeight / 4));
  const width = Math.min(420, availableWidth - margin * 2);
  const height = Math.min(760, Number.isFinite(requestedHeight) ? Math.max(220, Math.ceil(requestedHeight)) : 760, availableHeight - margin * 2);
  return { left: left + availableWidth - margin - width, top: top + availableHeight - margin - height, width, height };
}

/** Called by the extension page after creation, so screen.avail* describes its actual monitor. */
export async function positionFindingsWindow(): Promise<boolean> {
  try {
    const workScreen = screen as Screen & { availLeft?: number; availTop?: number };
    const content = typeof document === 'undefined' ? null : document.querySelector('[data-protect-findings]');
    const contentHeight = content?.getBoundingClientRect().height;
    const chromeHeight = typeof window === 'undefined' ? 0 : Math.max(0, window.outerHeight - window.innerHeight);
    const bounds = findingsWindowBounds({ left: workScreen.availLeft ?? 0, top: workScreen.availTop ?? 0, width: workScreen.availWidth, height: workScreen.availHeight }, contentHeight === undefined ? 760 : contentHeight + chromeHeight);
    if (bounds === null) return false;
    const current = await chrome.windows.getCurrent();
    if (current.id === undefined || current.type !== 'popup') return false;
    // Creation is unfocused in the SW; repositioning preserves the user's current focus.
    await chrome.windows.update(current.id, bounds);
    return true;
  } catch {
    return false;
  }
}
