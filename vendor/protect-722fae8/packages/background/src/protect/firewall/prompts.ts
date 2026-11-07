// ADR-020 §C, §D (S08): per-tab firewall state behind the popup card — the decision prompt of (tab, site), the
// receivers with evidence (≤ maxFirewallReceivers) and their lower-bound delivery counters, and the notices
// (≤ maxNoticesPerTab). Memory first; persisted into the `firewall` section of the tab's top-level document in
// storage.session (doc-store), so it survives a service-worker restart. The prompt follows same-site navigations
// of the tab and is dropped on a cross-site one. A prompt names at most maxPromptReceivers receivers; the rest are
// counted in `hidden`. Receivers come only from browser-observed request hosts (value-match evidence), never from
// page-controlled data.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_WIRE_LIMITS, VALUE_ENCODINGS, FIELD_KINDS } from '@detect-expert/contracts';
import type {
  DeliveryState,
  FirewallNotice,
  FirewallPromptView,
  FirewallReceiverView,
  FirewallSender,
  ProtectTransferEvidence,
} from '@detect-expert/contracts';
import type { ProtectDocStore, ProtectFirewallSection } from '../doc-store';
import { MAX_PROTECT_TABS } from '../tab-model';

/** Delivery counters are written to storage.session at most this often (memory is always current). */
export const FIREWALL_PERSIST_MS = 1000;

export interface TabFirewallState {
  tabId: number;
  /** Top-level document the state is persisted under. */
  topKey: string;
  site: string;
  prompt: FirewallPromptView | null;
  receivers: Map<string, FirewallReceiverView>;
  notices: FirewallNotice[];
}

function randomHex16(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
  return out;
}

/** A fresh prompt / undo id (PROMPT_ID_PATTERN, UNDO_ID_PATTERN). */
export function newFirewallId(): string {
  return randomHex16();
}

function senderOf(ev: ProtectTransferEvidence): FirewallSender {
  return {
    frame: ev.frameContext === 'top' ? 'top' : 'subframe',
    initiatorSite: ev.initiatorSite ?? null,
    // A script is named only from a sampled stack (page-controlled; the UI says so).
    ...(ev.attributionConfidence === 'sampled-stack' && ev.script !== undefined ? { script: { ...ev.script } } : {}),
    attributionConfidence: ev.attributionConfidence,
  };
}

function canonical<T extends string>(order: readonly T[], values: Iterable<T>, max: number): T[] {
  const set = new Set(values);
  return order.filter((v) => set.has(v)).slice(0, max);
}

export class FirewallPromptBook {
  private readonly tabs = new Map<number, TabFirewallState>();
  private readonly dirty = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly docStore: ProtectDocStore,
    private readonly persistMs: number = FIREWALL_PERSIST_MS,
  ) {}

  get size(): number {
    return this.tabs.size;
  }

  /** Tabs with state (the onSendHeaders fast path skips everything when there are none). */
  has(tabId: number): boolean {
    return this.tabs.has(tabId);
  }

  /**
   * State of the tab for its current top document `topKey` on `site`. Hydrates from the document's section after a
   * SW restart; a known state of another site is reset; a same-site navigation carries the state to the new document.
   */
  state(tabId: number, topKey: string, site: string): TabFirewallState {
    let s = this.tabs.get(tabId);
    if (s !== undefined && s.site !== site) {
      this.tabs.delete(tabId);
      s = undefined;
    }
    if (s === undefined) {
      s = { tabId, topKey, site, prompt: null, receivers: new Map(), notices: [] };
      const section = this.docStore.doc(topKey)?.firewall;
      if (section !== undefined) this.hydrate(s, section);
      this.tabs.set(tabId, s);
      while (this.tabs.size > MAX_PROTECT_TABS) {
        const oldest = this.tabs.keys().next();
        if (oldest.done) break;
        this.tabs.delete(oldest.value);
      }
    } else if (s.topKey !== topKey) {
      s.topKey = topKey;
      this.markDirty(tabId, true);
    }
    return s;
  }

  /**
   * Review PT-4: the script of these receivers' views carried a typed value (value-match scrubbed its own records):
   * the view keeps the frame and the initiator only (frame-only) and is persisted at once.
   */
  dropScripts(tabId: number, receivers: readonly string[]): number {
    const s = this.tabs.get(tabId);
    if (s === undefined) return 0;
    let n = 0;
    for (const receiver of receivers) {
      const view = s.receivers.get(receiver);
      if (view === undefined || view.sender.script === undefined) continue;
      view.sender = { frame: view.sender.frame, initiatorSite: view.sender.initiatorSite, attributionConfidence: 'frame-only' };
      n++;
    }
    if (n > 0) this.markDirty(tabId, true);
    return n;
  }

  /** Existing state only (no hydration): onSendHeaders hot path and projections of unknown tabs. */
  peek(tabId: number): TabFirewallState | undefined {
    return this.tabs.get(tabId);
  }

  private hydrate(s: TabFirewallState, section: Readonly<ProtectFirewallSection>): void {
    if (section.prompt !== undefined && section.prompt.site === s.site) s.prompt = { ...section.prompt, receivers: [...section.prompt.receivers] };
    for (const r of section.receivers.slice(0, PROTECT_WIRE_LIMITS.maxFirewallReceivers)) s.receivers.set(r.receiver, { ...r, delivery: { ...r.delivery }, effectiveRule: null });
    s.notices = section.notices.slice(-PROTECT_BUDGETS.maxNoticesPerTab).map((n) => ({ ...n }));
  }

  /** Adds or updates the receiver view from a transfer evidence record (≤ maxFirewallReceivers; oldest goes first). */
  noteEvidence(s: TabFirewallState, ev: ProtectTransferEvidence): void {
    const receiver = ev.receiver;
    if (receiver === undefined) return;
    const prev = s.receivers.get(receiver);
    const view: FirewallReceiverView = {
      receiver,
      relation: ev.relation,
      effectiveRule: null,
      delivery: prev?.delivery ?? { sent: 0, stopped: 0, stoppedOther: 0, unknown: 0 },
      countQuality: 'lower-bound',
      lastDelivery: prev?.lastDelivery ?? 'unknown',
      fieldKinds: canonical(FIELD_KINDS, [...(prev?.fieldKinds ?? []), ev.fieldKind], FIELD_KINDS.length),
      encodings: canonical(VALUE_ENCODINGS, [...(prev?.encodings ?? []), ...ev.encodings], PROTECT_WIRE_LIMITS.maxEvidenceEncodings),
      submitTiming: ev.submitTiming,
      ...(ev.sinceInput === undefined ? {} : { sinceInput: ev.sinceInput }),
      sender: senderOf(ev),
      vendorConfidence: 'none',
    };
    s.receivers.delete(receiver);
    s.receivers.set(receiver, view);
    while (s.receivers.size > PROTECT_WIRE_LIMITS.maxFirewallReceivers) {
      const oldest = s.receivers.keys().next();
      if (oldest.done) break;
      s.receivers.delete(oldest.value);
    }
    this.markDirty(s.tabId, true);
  }

  /**
   * Adds receivers to the prompt of (tab, site): ≤ maxPromptReceivers named, the rest counted in `hidden`. A full
   * prompt gives the place of an already decided receiver (strict preset) to an undecided one first. True when it
   * changed.
   */
  addToPrompt(s: TabFirewallState, receivers: readonly string[], isDecided: (receiver: string) => boolean = () => false): boolean {
    const current = s.prompt;
    const list = current === null ? [] : [...current.receivers];
    let hidden = current?.hidden ?? 0;
    let changed = false;
    for (const r of receivers) {
      if (list.includes(r)) continue;
      if (list.length < PROTECT_BUDGETS.maxPromptReceivers) list.push(r);
      else {
        const decided = isDecided(r) ? -1 : list.findIndex((x) => isDecided(x));
        if (decided >= 0) {
          list.splice(decided, 1);
          list.push(r);
        } else hidden = Math.min(MAX_COUNT, hidden + 1);
      }
      changed = true;
    }
    if (!changed) return false;
    // A new id whenever the named receivers change: a decision on an older list is stale.
    s.prompt = { promptId: newFirewallId(), site: s.site, receivers: list, hidden };
    this.markDirty(s.tabId, true);
    return true;
  }

  /** Removes decided receivers from the prompt (the prompt goes when none is left). */
  removeFromPrompt(s: TabFirewallState, receivers: readonly string[]): void {
    if (s.prompt === null) return;
    const left = s.prompt.receivers.filter((r) => !receivers.includes(r));
    if (left.length === s.prompt.receivers.length) return;
    s.prompt = left.length === 0 ? null : { ...s.prompt, receivers: left };
    this.markDirty(s.tabId, true);
  }

  clearPrompt(s: TabFirewallState): void {
    if (s.prompt === null) return;
    s.prompt = null;
    this.markDirty(s.tabId, true);
  }

  /** Adds a notice (same kind and receiver: replaced); ≤ maxNoticesPerTab, oldest first out. */
  addNotice(s: TabFirewallState, notice: FirewallNotice): void {
    s.notices = s.notices.filter((n) => !(n.kind === notice.kind && n.receiver === notice.receiver && n.site === notice.site));
    s.notices.push(notice);
    if (s.notices.length > PROTECT_BUDGETS.maxNoticesPerTab) s.notices = s.notices.slice(-PROTECT_BUDGETS.maxNoticesPerTab);
    this.markDirty(s.tabId, true);
  }

  removeNotices(s: TabFirewallState, predicate: (n: FirewallNotice) => boolean): void {
    const next = s.notices.filter((n) => !predicate(n));
    if (next.length === s.notices.length) return;
    s.notices = next;
    this.markDirty(s.tabId, true);
  }

  /**
   * Lower-bound delivery counter of a receiver view of the tab (no-op for receivers without a view). It counts every
   * request to the receiver's domain, so `lastDelivery` is that of any such request — not of the request that carried
   * the value: the card's alert takes the delivery of the transfer record instead (review round 2, ADR-020 §11).
   */
  countDelivery(tabId: number, receiver: string, state: DeliveryState): boolean {
    const s = this.tabs.get(tabId);
    const view = s?.receivers.get(receiver);
    if (s === undefined || view === undefined) return false;
    const d = view.delivery;
    if (state === 'sent') d.sent = Math.min(MAX_COUNT, d.sent + 1);
    else if (state === 'stopped') d.stopped = Math.min(MAX_COUNT, d.stopped + 1);
    else if (state === 'stopped-other') d.stoppedOther = Math.min(MAX_COUNT, d.stoppedOther + 1);
    else d.unknown = Math.min(MAX_COUNT, d.unknown + 1);
    view.lastDelivery = state;
    this.markDirty(tabId, false);
    return true;
  }

  /** The receiver view of the tab whose domain is `host` or a parent of it (label suffix), or null. */
  receiverOfHost(tabId: number, host: string): string | null {
    const s = this.tabs.get(tabId);
    if (s === undefined || s.receivers.size === 0) return null;
    let i = 0;
    for (;;) {
      const candidate = i === 0 ? host : host.slice(i);
      if (s.receivers.has(candidate)) return candidate;
      const dot = host.indexOf('.', i);
      if (dot < 0) return null;
      i = dot + 1;
    }
  }

  forget(tabId: number): void {
    this.tabs.delete(tabId);
    this.dirty.delete(tabId);
  }

  clear(): void {
    this.tabs.clear();
    this.dirty.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private markDirty(tabId: number, now: boolean): void {
    this.dirty.add(tabId);
    if (now) {
      this.persist(tabId);
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.persistMs);
  }

  private persist(tabId: number): void {
    const s = this.tabs.get(tabId);
    this.dirty.delete(tabId);
    if (s === undefined) return;
    this.docStore.update(s.topKey, s.tabId, 'firewall', () => ({
      ...(s.prompt === null ? {} : { prompt: { ...s.prompt, receivers: [...s.prompt.receivers] } }),
      notices: s.notices.map((n) => ({ ...n })),
      receivers: [...s.receivers.values()].map((r) => ({ ...r, effectiveRule: null, delivery: { ...r.delivery } })),
    }));
  }

  /** Writes every dirty tab (delivery counters) into the doc-store. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const tabId of [...this.dirty]) this.persist(tabId);
  }
}
