// ADR-020 §D (S09): actions of the firewall UI.
// - Popup card (useFirewallCard): decide (ui-protect-decide), undo, dismiss («Понятно»), snooze («Не беспокоить 1 час»).
//   The SW answers protect-decision with `report: null` (S08-5), so the projection is read again after each action.
//   A stale prompt (stale-revision / document-mismatch) gives fw_resolved_stale and a fresh projection; nothing is
//   claimed blocked unless the SW says ruleApplied for that receiver.
// - Options rules (useFirewallRules): list with a 300 ms debounced search, action filter and pages of ≤ 200 rows,
//   tri-state selection, removal of the selected rules, «Удалить все правила фаервола» (ui-protect-purge decisions)
//   and the blocking mode (ui-protect-set-settings preset, Options only).
// One action at a time; answers of an outdated request are dropped. Nothing is stored by the page.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { DecisionScope, FirewallAction, ProtectPreset, ProtectProjection } from '@detect-expert/contracts';
import { errorMessageKey, protectUi } from '../messaging';
import type { SendFailureCode } from '../messaging';
import { joinMessages, msg } from '../view-models/message';
import type { Message } from '../view-models/message';
import { EMPTY_FIREWALL_DRAFT, firewallNeedsRestart, readDecisionAnswer } from '../view-models/protect-firewall';
import type { FirewallCardVM, FirewallDraft, FirewallResolution } from '../view-models/protect-firewall';
import { RULES_SEARCH_DEBOUNCE_MS, normalizeDomainFilter, readRulesAnswer, removalKeys, rulesRequest, toggleAllShown } from '../view-models/protect-firewall-rules';
import type { RulesActionFilter, RulesAnswer, RulesQuery } from '../view-models/protect-firewall-rules';

export interface FirewallMessage {
  message: Message;
  tone: 'attention' | 'error' | 'neutral';
}

function failure(code: SendFailureCode, receivers: ReadonlyArray<string> = []): FirewallMessage {
  if (code === 'stale-revision' || code === 'document-mismatch') return { message: msg('fw_resolved_stale'), tone: 'attention' };
  if (code === 'unsafe-receiver') return { message: msg('fw_unsafe_receiver', joinMessages([...receivers])), tone: 'attention' };
  return { message: msg(errorMessageKey(code)), tone: code === 'unavailable' ? 'error' : 'attention' };
}

// ---------------------------------------------------------------------------
// Popup card
// ---------------------------------------------------------------------------

export interface FirewallCardSession {
  draft: FirewallDraft;
  setScope(scope: DecisionScope): void;
  setReceiver(receiver: string, checked: boolean): void;
  busy: boolean;
  /** The outcome shown instead of the card (FirewallResolved), until closed or undone. */
  resolution: FirewallResolution | null;
  message: FirewallMessage | null;
  decide(card: FirewallCardVM, action: FirewallAction): Promise<boolean>;
  /** «Понятно» (warn-only, no permission). */
  dismiss(card: FirewallCardVM): Promise<boolean>;
  /** Undo of the shown resolution, or of a strict-auto notice (`undoId`). */
  undo(undoId?: string): Promise<boolean>;
  snooze(minutes: 0 | 60): Promise<boolean>;
  closeResolution(): void;
}

export interface FirewallCardOptions {
  tabId: number | null;
  report: ProtectProjection | null;
  refreshReport: () => Promise<void>;
  refreshState: () => Promise<void>;
}

export function useFirewallCard(options: FirewallCardOptions): FirewallCardSession {
  const [draft, setDraft] = useState<FirewallDraft>(EMPTY_FIREWALL_DRAFT);
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState<FirewallResolution | null>(null);
  const [message, setMessage] = useState<FirewallMessage | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const promptRef = useRef<string | null>(null);
  const resolutionRef = useRef<FirewallResolution | null>(null);
  resolutionRef.current = resolution;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A new prompt (another id) starts from the defaults.
  const promptId = (options.report?.firewall as { prompt?: { promptId?: unknown } | null } | undefined)?.prompt?.promptId;
  useEffect(() => {
    const id = typeof promptId === 'string' ? promptId : null;
    if (id !== promptRef.current) {
      promptRef.current = id;
      setDraft(EMPTY_FIREWALL_DRAFT);
    }
  }, [promptId]);

  const exclusive = useCallback(async (work: () => Promise<boolean>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      return await work();
    } catch {
      if (mountedRef.current) setMessage({ message: msg('error_unavailable'), tone: 'error' });
      return false;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const setScope = useCallback((scope: DecisionScope) => setDraft((d) => ({ ...d, scope })), []);
  const setReceiver = useCallback((receiver: string, checked: boolean) => {
    setDraft((d) => ({ ...d, unchecked: checked ? d.unchecked.filter((r) => r !== receiver) : [...d.unchecked.filter((r) => r !== receiver), receiver] }));
  }, []);

  const decide = useCallback((card: FirewallCardVM, action: FirewallAction): Promise<boolean> => {
    const tabId = optionsRef.current.tabId;
    if (tabId === null || !card.canDecide || card.mode !== 'decide') return Promise.resolve(false);
    const restart = firewallNeedsRestart(optionsRef.current.report);
    return exclusive(async () => {
      setMessage(null);
      const result = await protectUi.decide({
        tabId,
        documentKey: card.documentKey,
        protectRevision: card.protectRevision,
        promptId: card.promptId,
        receivers: [...card.selected],
        action,
        scope: card.scope,
      });
      if (!result.ok) {
        if (mountedRef.current) setMessage(failure(result.code, card.selected));
        await optionsRef.current.refreshReport();
        return false;
      }
      const answer = readDecisionAnswer(result.response);
      if (answer === null) {
        if (mountedRef.current) setMessage(failure('unavailable'));
        return false;
      }
      if (mountedRef.current) {
        setResolution({ kind: 'decided', action, scope: card.scope, receivers: [...card.selected], applied: answer.applied, undoId: answer.undoId, restart });
        setDraft(EMPTY_FIREWALL_DRAFT);
      }
      await optionsRef.current.refreshReport();
      return true;
    });
  }, [exclusive]);

  const dismiss = useCallback((card: FirewallCardVM): Promise<boolean> => {
    const tabId = optionsRef.current.tabId;
    if (tabId === null) return Promise.resolve(false);
    return exclusive(async () => {
      setMessage(null);
      const result = await protectUi.dismiss({ tabId, documentKey: card.documentKey, protectRevision: card.protectRevision, promptId: card.promptId });
      if (!result.ok) {
        if (mountedRef.current) setMessage(failure(result.code));
        await optionsRef.current.refreshReport();
        return false;
      }
      if (mountedRef.current) setResolution({ kind: 'dismissed', action: null, scope: null, receivers: [], applied: [], undoId: null, restart: false });
      await optionsRef.current.refreshReport();
      return true;
    });
  }, [exclusive]);

  const undo = useCallback((undoId?: string): Promise<boolean> => {
    const tabId = optionsRef.current.tabId;
    const id = undoId ?? resolutionRef.current?.undoId ?? null;
    if (tabId === null || id === null) return Promise.resolve(false);
    return exclusive(async () => {
      setMessage(null);
      const result = await protectUi.undo({ tabId, undoId: id });
      if (!result.ok) {
        if (mountedRef.current) setMessage(failure(result.code));
        await optionsRef.current.refreshReport();
        return false;
      }
      if (mountedRef.current) setResolution(null);
      await optionsRef.current.refreshReport();
      return true;
    });
  }, [exclusive]);

  const snooze = useCallback((minutes: 0 | 60): Promise<boolean> => exclusive(async () => {
    setMessage(null);
    const result = await protectUi.snooze(minutes);
    if (!result.ok) {
      if (mountedRef.current) setMessage(failure(result.code));
      return false;
    }
    if (mountedRef.current) setResolution(null);
    await optionsRef.current.refreshState();
    await optionsRef.current.refreshReport();
    return true;
  }), [exclusive]);

  const closeResolution = useCallback(() => {
    setResolution(null);
    setMessage(null);
  }, []);

  return { draft, setScope, setReceiver, busy, resolution, message, decide, dismiss, undo, snooze, closeResolution };
}

// ---------------------------------------------------------------------------
// Options rules
// ---------------------------------------------------------------------------

export interface FirewallRulesSession {
  query: RulesQuery;
  searchText: string;
  searchInvalid: boolean;
  setSearchText(text: string): void;
  setAction(action: RulesActionFilter): void;
  setPage(page: number): void;
  answer: RulesAnswer | null;
  /** The last list request failed (feature-disabled, module-disabled, unavailable…). */
  failureCode: SendFailureCode | null;
  busy: boolean;
  selected: ReadonlySet<string>;
  toggle(ruleKey: string, checked: boolean): void;
  toggleAllShown(): void;
  removeSelected(): Promise<boolean>;
  clearAll(): Promise<boolean>;
  applyMode(preset: ProtectPreset): Promise<boolean>;
  message: FirewallMessage | null;
  reload(): Promise<void>;
}

export interface FirewallRulesOptions {
  /** List only while the firewall feature runs (otherwise the SW answers feature-disabled). */
  enabled: boolean;
  refreshState: () => Promise<void>;
}

export function useFirewallRules(options: FirewallRulesOptions): FirewallRulesSession {
  const [query, setQuery] = useState<RulesQuery>({ filter: undefined, action: 'all', page: 0 });
  const [searchText, setSearchTextValue] = useState('');
  const [searchInvalid, setSearchInvalid] = useState(false);
  const [answer, setAnswer] = useState<RulesAnswer | null>(null);
  const [failureCode, setFailureCode] = useState<SendFailureCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<FirewallMessage | null>(null);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const queryRef = useRef(query);
  queryRef.current = query;
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const load = useCallback(async (q: RulesQuery): Promise<void> => {
    const seq = ++seqRef.current;
    const result = await protectUi.listRules(rulesRequest(q));
    if (!mountedRef.current || seq !== seqRef.current) return;
    if (!result.ok) {
      setFailureCode(result.code);
      setAnswer(null);
      return;
    }
    const parsed = readRulesAnswer(result.response);
    setFailureCode(parsed === null ? 'unavailable' : null);
    setAnswer(parsed);
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      setAnswer(null);
      setFailureCode(null);
      return;
    }
    void load(query);
  }, [options.enabled, query, load]);

  const setSearchText = useCallback((text: string) => {
    setSearchTextValue(text);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      const filter = normalizeDomainFilter(text);
      setSearchInvalid(filter === null);
      if (filter === null) return;
      if (filter === queryRef.current.filter) return;
      setSelected(new Set());
      setQuery((q) => ({ ...q, filter, page: 0 }));
    }, RULES_SEARCH_DEBOUNCE_MS);
  }, []);

  const setAction = useCallback((action: RulesActionFilter) => {
    setSelected(new Set());
    setQuery((q) => ({ ...q, action, page: 0 }));
  }, []);

  const setPage = useCallback((page: number) => setQuery((q) => ({ ...q, page: Math.max(0, page) })), []);

  const toggle = useCallback((ruleKey: string, checked: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(ruleKey);
      else next.delete(ruleKey);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((s) => toggleAllShown(answerRef.current?.rows ?? [], s));
  }, []);

  const exclusive = useCallback(async (work: () => Promise<boolean>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      return await work();
    } catch {
      if (mountedRef.current) setMessage({ message: msg('error_unavailable'), tone: 'error' });
      return false;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const removeSelected = useCallback((): Promise<boolean> => exclusive(async () => {
    const keys = removalKeys(answerRef.current?.rows ?? [], selectedRef.current);
    if (keys.length === 0) return false;
    const result = await protectUi.removeRules({ ruleKeys: keys });
    if (!result.ok) {
      if (mountedRef.current) setMessage(failure(result.code));
      return false;
    }
    if (mountedRef.current) {
      setSelected(new Set());
      setMessage({ message: msg('fw_rules_removed', keys.length), tone: 'neutral' });
    }
    await load(queryRef.current);
    await optionsRef.current.refreshState();
    return true;
  }), [exclusive, load]);

  const clearAll = useCallback((): Promise<boolean> => exclusive(async () => {
    const result = await protectUi.purge('decisions');
    if (!result.ok) {
      if (mountedRef.current) setMessage(failure(result.code));
      return false;
    }
    // The SW removes our rules before answering (SP-5); when Chrome did not complete it, say so.
    const pending = result.response.state.degradedReasons.includes('blocking-unavailable');
    if (mountedRef.current) {
      setSelected(new Set());
      setMessage(pending ? { message: msg('protect_reason_blocking_unavailable'), tone: 'attention' } : { message: msg('fw_rules_cleared'), tone: 'neutral' });
    }
    await load(queryRef.current);
    await optionsRef.current.refreshState();
    return true;
  }), [exclusive, load]);

  const applyMode = useCallback((preset: ProtectPreset): Promise<boolean> => exclusive(async () => {
    const result = await protectUi.setSettings({ preset });
    if (!result.ok) {
      if (mountedRef.current) setMessage(failure(result.code));
      return false;
    }
    if (mountedRef.current) setMessage({ message: msg('fw_mode_applied'), tone: 'neutral' });
    await optionsRef.current.refreshState();
    await load(queryRef.current);
    return true;
  }), [exclusive, load]);

  const reload = useCallback(() => load(queryRef.current), [load]);

  return {
    query, searchText, searchInvalid, setSearchText, setAction, setPage, answer, failureCode, busy, selected,
    toggle, toggleAllShown: toggleAll, removeSelected, clearAll, applyMode, message, reload,
  };
}
