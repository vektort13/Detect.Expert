// ADR-058: narrow ISOLATED client. MAIN events and public page messages are never consumed.
import type { UiResponse } from '@detect-expert/contracts';
import type { OverlayActionMessage, OverlayShowMessage } from './overlay-protocol';

export type OverlayResult = { ok: true; value: OverlayShowMessage | null; response?: UiResponse } | { ok: false; code: string };
let current: OverlayShowMessage | null = null;
let gesture = 0;
let gestureSequence = 0;
let gestureTimer: ReturnType<typeof setTimeout> | undefined;
let elementLookup: ((id: string) => HTMLElement | null) | null = null;
export function setOverlayElementLookup(lookup: (id: string) => HTMLElement | null): void { elementLookup = lookup; }
export function overlayElementById(id: string): HTMLElement | null { return elementLookup?.(id) ?? null; }

export function setOverlayTarget(value: OverlayShowMessage | null): void {
  const changed = value === null || current === null || current.generation !== value.generation || current.kind !== value.kind || current.documentKey !== value.documentKey;
  current = value;
  if (changed) { gesture = 0; if (gestureTimer !== undefined) clearTimeout(gestureTimer); gestureTimer = undefined; }
}

/** Called only by the closed root's capture listener after native trusted-event and hit-test checks. */
export function allowOverlayGesture(event: Event): void {
  if (!event.isTrusted) return;
  const ticket = ++gestureSequence;
  gesture = ticket;
  if (gestureTimer !== undefined) clearTimeout(gestureTimer);
  // Native dispatch can run a microtask checkpoint between capture and the button's bubble handler.
  gestureTimer = setTimeout(() => { if (gesture === ticket) gesture = 0; gestureTimer = undefined; }, 0);
}

export async function overlayAction(action: OverlayActionMessage['action'], request?: unknown): Promise<OverlayResult> {
  const target = current;
  if (target === null) return { ok: false, code: 'document-mismatch' };
  if (!['refresh', 'close'].includes(action)) {
    if (gesture === 0) return { ok: false, code: 'unauthorized-sender' };
    gesture = 0;
    if (gestureTimer !== undefined) clearTimeout(gestureTimer); gestureTimer = undefined;
  }
  const message: OverlayActionMessage = { schemaVersion: 1, type: 'protect-overlay-action', kind: target.kind, generation: target.generation, documentKey: target.documentKey, action, ...(request === undefined ? {} : { request }) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw: unknown = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); }),
    ]);
    if (typeof raw !== 'object' || raw === null || !('ok' in raw)) return { ok: false, code: 'unavailable' };
    const result = raw as OverlayResult;
    if (result.ok === false && typeof result.code === 'string') return result;
    if (result.ok === true && 'value' in result) return result;
    return { ok: false, code: 'unavailable' };
  } catch { return { ok: false, code: 'unavailable' }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
