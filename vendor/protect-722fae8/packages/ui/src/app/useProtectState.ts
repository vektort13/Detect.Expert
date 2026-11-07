// ADR-020 «Защита» (S06): the module state for Options, popup and side panel. One `ui-protect-get-state` when the page
// opens and after each action; no polling. With `watch`, a change of the settings record in storage.local and Chrome
// permission events re-read it (another Options tab, a revoke in chrome://extensions).
// Every action that may widen the module asks Chrome first, synchronously inside the click (ADR-020 §6): enable →
// all sites (+ the request rules permission for firewall / gpc); turning on firewall or gpc later → the same request.
// After «Выключить» / «Удалить все данные модуля» the SW has removed our rules (SP-5); then the optional DNR grant goes.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ProtectFeature, ProtectPreset, ProtectSnoozeMinutes, ProtectState, UiProtectStateResponse } from '@detect-expert/contracts';
import { PROTECT_SETTINGS_KEY } from '@detect-expert/engine';
import { errorMessageKey, protectUi, removeProtectDnrPermission, requestProtectPermissions } from '../messaging';
import type { ProtectSendResult, SendFailureCode } from '../messaging';
import type { Tone } from '../view-models/coverage';
import { msg } from '../view-models/message';
import type { Message } from '../view-models/message';
import { featureChangePermissionRequest, protectPermissionRequest } from '../view-models/protect';

export interface ProtectNotice {
  message: Message;
  tone: Tone;
}

export interface ProtectStateOptions {
  /** Re-read the state on settings / permission events (Options, side panel). */
  watch?: boolean;
}

export interface ProtectStateSession {
  /** null until the first answer, or when the SW never answered with a well-formed state. */
  state: ProtectState | null;
  loaded: boolean;
  /** The last read reached the SW. */
  available: boolean;
  busy: boolean;
  notice: ProtectNotice | null;
  dismissNotice(): void;
  refresh(): Promise<void>;
  /** Call directly from the click: chrome.permissions.request runs before anything else. Options only. */
  enable(features: ReadonlyArray<ProtectFeature>, preset: ProtectPreset): Promise<boolean>;
  /** Call directly from the change event (a DNR feature may need the permission request). Options only. */
  setFeatures(features: ReadonlyArray<ProtectFeature>): Promise<boolean>;
  setPreset(preset: ProtectPreset): Promise<boolean>;
  snooze(minutes: ProtectSnoozeMinutes): Promise<boolean>;
  setSite(host: string, excluded: boolean): Promise<boolean>;
  disable(purge: boolean): Promise<boolean>;
  purgeAll(): Promise<boolean>;
}

function errorNotice(code: SendFailureCode): ProtectNotice {
  return { message: msg(errorMessageKey(code)), tone: code === 'unavailable' ? 'error' : 'attention' };
}

export function useProtectState(options: ProtectStateOptions = {}): ProtectStateSession {
  const watch = options.watch ?? false;
  const [state, setStateValue] = useState<ProtectState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNoticeValue] = useState<ProtectNotice | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const stateRef = useRef<ProtectState | null>(null);
  /** Only the answer of the latest read or action is applied (no stale overwrite). */
  const seqRef = useRef(0);

  const setNotice = useCallback((next: ProtectNotice | null) => {
    if (mountedRef.current) setNoticeValue(next);
  }, []);

  const accept = useCallback((seq: number, next: ProtectState) => {
    if (!mountedRef.current || seq !== seqRef.current) return;
    stateRef.current = next;
    setStateValue(next);
    setAvailable(true);
    setLoaded(true);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current;
    const result = await protectUi.getState();
    if (result.ok) accept(seq, result.response.state);
    else if (mountedRef.current && seq === seqRef.current) {
      setAvailable(result.code !== 'unavailable');
      setLoaded(true);
    }
  }, [accept]);

  /** One action at a time; `work` receives the sequence number its answer must still match. */
  const exclusive = useCallback((work: (seq: number) => Promise<boolean>): Promise<boolean> => {
    busyRef.current = true;
    setBusy(true);
    const seq = ++seqRef.current;
    return work(seq)
      .catch(() => {
        setNotice(errorNotice('unavailable'));
        return false;
      })
      .finally(() => {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      });
  }, [setNotice]);

  const applyState = useCallback((seq: number, result: ProtectSendResult<UiProtectStateResponse>, success: Message | null): boolean => {
    if (!result.ok) {
      setNotice(errorNotice(result.code));
      return false;
    }
    accept(seq, result.response.state);
    setNotice(success === null ? null : { message: success, tone: 'neutral' });
    return true;
  }, [accept, setNotice]);

  const enable = useCallback((features: ReadonlyArray<ProtectFeature>, preset: ProtectPreset): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false);
    // ADR-020 §6: first, synchronously inside the user gesture.
    const granted = requestProtectPermissions(protectPermissionRequest(features));
    return exclusive(async (seq) => {
      if (!(await granted)) {
        setNotice({ message: msg('protect_permission_denied'), tone: 'attention' });
        return false;
      }
      return applyState(seq, await protectUi.enable(features, preset), msg('protect_reload_note'));
    });
  }, [applyState, exclusive, setNotice]);

  const setFeatures = useCallback((features: ReadonlyArray<ProtectFeature>): Promise<boolean> => {
    const current = stateRef.current;
    if (busyRef.current || current === null || features.length === 0) return Promise.resolve(false);
    const request = featureChangePermissionRequest(current, features);
    // Same path as the consent screen: the request runs inside the change event, before any await.
    const granted = request === null ? Promise.resolve(true) : requestProtectPermissions(request);
    return exclusive(async (seq) => {
      if (!(await granted)) {
        setNotice({ message: msg('protect_permission_denied'), tone: 'attention' });
        return false;
      }
      return applyState(seq, await protectUi.setSettings({ features: [...features] }), msg('protect_reload_note'));
    });
  }, [applyState, exclusive, setNotice]);

  const setPreset = useCallback((preset: ProtectPreset): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false);
    return exclusive(async (seq) => applyState(seq, await protectUi.setSettings({ preset }), null));
  }, [applyState, exclusive]);

  const snooze = useCallback((minutes: ProtectSnoozeMinutes): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false);
    return exclusive(async (seq) => applyState(seq, await protectUi.snooze(minutes), null));
  }, [applyState, exclusive]);

  const setSite = useCallback((host: string, excluded: boolean): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false);
    // Removing an exclusion takes effect on pages loaded afterwards; adding one stops the module there now.
    return exclusive(async (seq) => applyState(seq, await protectUi.setSite(host, excluded), excluded ? null : msg('protect_reload_note')));
  }, [applyState, exclusive]);

  const stopModule = useCallback((send: () => Promise<ProtectSendResult<UiProtectStateResponse>>): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false);
    return exclusive(async (seq) => {
      const result = await send();
      if (!result.ok) {
        setNotice(errorNotice(result.code));
        return false;
      }
      // The SW removes our DNR rules before answering (SP-5); only then the optional grant is dropped. When the
      // removal did not complete (cleanup pending: blocking-unavailable), the grant stays so the rules can still be
      // removed, and the notice says so instead of claiming they are gone (S08 follow-up).
      const rulesPending = result.response.state.degradedReasons.includes('blocking-unavailable');
      if (!rulesPending) await removeProtectDnrPermission();
      accept(seq, result.response.state);
      setNotice(rulesPending ? { message: msg('protect_disabled_notice_rules_pending'), tone: 'attention' } : { message: msg('protect_disabled_notice'), tone: 'neutral' });
      // Permissions changed after the answer: read the state once more (permission flags).
      const again = await protectUi.getState();
      if (again.ok) accept(seq, again.response.state);
      return true;
    });
  }, [accept, exclusive, setNotice]);

  const disable = useCallback((purge: boolean) => stopModule(() => protectUi.disable(purge)), [stopModule]);
  const purgeAll = useCallback(() => stopModule(() => protectUi.purge('all')), [stopModule]);
  const dismissNotice = useCallback(() => setNotice(null), [setNotice]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!watch) return;
    const onStorage = (changes: Record<string, unknown>): void => {
      if (Object.prototype.hasOwnProperty.call(changes, PROTECT_SETTINGS_KEY)) void refresh();
    };
    const onPermissions = (): void => {
      void refresh();
    };
    const subscriptions: Array<() => void> = [];
    try {
      chrome.storage.local.onChanged.addListener(onStorage);
      subscriptions.push(() => chrome.storage.local.onChanged.removeListener(onStorage));
    } catch {
      // storage events unavailable (static preview): the state is read after each action instead
    }
    try {
      chrome.permissions.onAdded.addListener(onPermissions);
      chrome.permissions.onRemoved.addListener(onPermissions);
      subscriptions.push(() => {
        chrome.permissions.onAdded.removeListener(onPermissions);
        chrome.permissions.onRemoved.removeListener(onPermissions);
      });
    } catch {
      // permission events unavailable
    }
    return () => {
      for (const unsubscribe of subscriptions) {
        try {
          unsubscribe();
        } catch {
          // ignore
        }
      }
    };
  }, [watch, refresh]);

  return { state, loaded, available, busy, notice, dismissNotice, refresh, enable, setFeatures, setPreset, snooze, setSite, disable, purgeAll };
}
