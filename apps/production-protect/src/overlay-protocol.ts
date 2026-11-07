// ADR-058: extension SW <-> exact top-level ISOLATED document only; never a window/MAIN bridge.
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';

export type OverlayKind = 'activation' | 'findings';
export interface OverlayShowMessage {
  schemaVersion: 1;
  type: 'protect-overlay-show';
  kind: OverlayKind;
  generation: number;
  tabId: number;
  documentKey: string;
  locale: string;
  state: ProtectState;
  report: ProtectProjection | null;
  activation?: number;
}
export interface OverlayHideMessage {
  schemaVersion: 1;
  type: 'protect-overlay-hide';
  kind: OverlayKind;
  generation: number;
}
export interface OverlayAck {
  schemaVersion: 1;
  type: 'protect-overlay-ack';
  kind: OverlayKind;
  generation: number;
  accepted: boolean;
}
export interface OverlayActionMessage {
  schemaVersion: 1;
  type: 'protect-overlay-action';
  kind: OverlayKind;
  generation: number;
  documentKey: string;
  action: 'refresh' | 'close' | 'decide' | 'undo' | 'dismiss' | 'snooze' | 'settings';
  /** Only canonical bounded Firewall bodies; all target IDs are derived again from MessageSender. */
  request?: unknown;
}
