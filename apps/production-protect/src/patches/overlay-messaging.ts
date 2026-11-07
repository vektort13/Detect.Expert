// ADR-058: only this adapter is bundled into the inline surface. No generic privileged UI requests.
import type { UiProtectDecideRequest, UiProtectDismissRequest, UiProtectUndoRequest } from '@detect-expert/contracts';
import { overlayAction } from '../overlay-client';

export type SendFailureCode = string;
export function errorMessageKey(code: SendFailureCode): string {
  return code === 'review-required' ? 'fw_overlay_review_required' : 'error_' + code.replace(/-/g, '_');
}
async function send(action: 'decide' | 'dismiss' | 'undo' | 'snooze', request: object) {
  const result = await overlayAction(action, request);
  return result.ok && result.response ? { ok: true as const, response: result.response } : { ok: false as const, code: result.ok ? 'unavailable' : result.code };
}
type Body<T> = Omit<T, 'schemaVersion' | 'type' | 'tabId'>;
export const protectUi = Object.freeze({
  decide: (body: Omit<UiProtectDecideRequest, 'schemaVersion' | 'type'>) => {
    const { tabId: _tabId, ...request } = body;
    return send('decide', request satisfies Body<UiProtectDecideRequest>);
  },
  dismiss: (body: Omit<UiProtectDismissRequest, 'schemaVersion' | 'type'>) => {
    const { tabId: _tabId, ...request } = body;
    return send('dismiss', request satisfies Body<UiProtectDismissRequest>);
  },
  undo: (body: Omit<UiProtectUndoRequest, 'schemaVersion' | 'type'>) => send('undo', { undoId: body.undoId }),
  snooze: (minutes: number) => send('snooze', { minutes }),
});
export async function openProtectOptions(_section: string = 'firewall'): Promise<boolean> {
  return (await overlayAction('settings')).ok;
}
