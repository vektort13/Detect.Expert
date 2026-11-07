// ADR-054: transient confirmation of an actual user activation, never a page-controlled notification.
// Creation provenance reserves a slot while loading; only exact current document ownership permits removal.
const TOAST_PAGE = 'activation-toast.html';
const CLEANUP_DELAYS = [50, 150, 400, 900, 2000] as const;
type Ownership = 'owned' | 'other' | 'unknown';
interface ToastWindow { windowId: number; activation: number }
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validActivation = (value: unknown): value is number => validId(value) && value > 0;

function activationOf(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const url = new URL(raw);
    if (url.protocol + '//' + url.host + url.pathname !== chrome.runtime.getURL(TOAST_PAGE) || url.username !== '' || url.password !== '' || url.hash !== '') return null;
    const fields = [...url.searchParams];
    if (fields.length !== 1 || fields[0]?.[0] !== 'activation' || !/^[1-9]\d{0,15}$/.test(fields[0][1])) return null;
    const value = Number(fields[0][1]);
    return validActivation(value) && String(value) === fields[0][1] ? value : null;
  } catch { return null; }
}

async function ownership(window: chrome.windows.Window): Promise<{ kind: Ownership; activation: number | null }> {
  if (!validId(window.id) || window.type !== 'popup' || window.tabs?.length !== 1) return { kind: 'other', activation: null };
  const tab = window.tabs[0];
  const raw = tab?.pendingUrl ?? tab?.url;
  if (typeof raw === 'string') {
    const activation = activationOf(raw);
    return { kind: activation === null ? 'other' : 'owned', activation };
  }
  if (!validId(tab?.id)) return { kind: 'unknown', activation: null };
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType], windowIds: [window.id], frameIds: [0] });
    if (contexts.length > 32) return { kind: 'unknown', activation: null };
    // getContexts is asynchronous: pending navigation or tab replacement must supersede its earlier document.
    const current = await chrome.windows.get(window.id, { populate: true });
    if (current.id !== window.id || current.type !== 'popup' || current.tabs?.length !== 1 || current.tabs[0]?.id !== tab.id) return { kind: 'other', activation: null };
    const currentRaw = current.tabs[0]?.pendingUrl ?? current.tabs[0]?.url;
    if (typeof currentRaw === 'string') {
      const activation = activationOf(currentRaw);
      return { kind: activation === null ? 'other' : 'owned', activation };
    }
    const origin = chrome.runtime.getURL('').replace(/\/$/, '');
    const matches = contexts.filter(context => context.contextType === 'TAB' && context.windowId === window.id && context.tabId === tab.id && context.frameId === 0 && context.documentOrigin === origin);
    if (matches.length !== 1) return { kind: 'unknown', activation: null };
    const activation = activationOf(matches[0]?.documentUrl);
    return { kind: activation === null ? 'other' : 'owned', activation };
  } catch { return { kind: 'unknown', activation: null }; }
}

export class ActivationToastWindow {
  private generation = 0;
  private lastActivation = 0;
  private current: ToastWindow | null = null;
  private chain: Promise<void> = Promise.resolve();
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called only after a verified user enable actually activated the module. */
  show(activation: number, eligible: () => boolean): Promise<void> {
    if (!validActivation(activation) || activation <= this.lastActivation) return this.chain;
    this.lastActivation = activation;
    const generation = ++this.generation;
    this.clearCleanup();
    return this.enqueue(async () => {
      if (!this.eligible(generation, eligible)) return;
      this.clearCleanup();
      if (!await this.closeOwned()) { this.retryCleanup(generation); return; }
      if (!this.eligible(generation, eligible)) return;
      let made: chrome.windows.Window | undefined;
      try {
        made = await chrome.windows.create({ url: chrome.runtime.getURL(TOAST_PAGE) + '?activation=' + String(activation), type: 'popup', focused: false, width: 360, height: 210 });
      } catch { return; }
      if (!validId(made?.id)) return;
      this.current = { windowId: made.id, activation };
      if (!this.eligible(generation, eligible) && !await this.closeOwned()) this.retryCleanup(this.generation);
    });
  }

  /** Invalidate immediately; delayed browser results cannot resurrect a cancelled confirmation. */
  cancel(): void {
    const generation = ++this.generation;
    this.clearCleanup();
    void this.enqueue(async () => { if (!await this.closeOwned()) this.retryCleanup(generation); });
  }

  private eligible(generation: number, eligible: () => boolean): boolean {
    if (generation !== this.generation) return false;
    try { return eligible() === true; } catch { return false; }
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(work, work).catch(() => undefined);
    return this.chain;
  }
  private clearCleanup(): void {
    if (this.cleanupTimer !== null) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
  }
  private retryCleanup(generation: number, attempt = 0): void {
    const delay = CLEANUP_DELAYS[attempt];
    if (generation !== this.generation || delay === undefined || this.cleanupTimer !== null) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      if (generation !== this.generation) return;
      void this.enqueue(async () => { if (!await this.closeOwned()) this.retryCleanup(generation, attempt + 1); });
    }, delay);
  }

  /** Current exact owned pages, including ones surviving a SW restart; no ID alone grants removal. */
  private async closeOwned(): Promise<boolean> {
    let windows: chrome.windows.Window[];
    try { windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] }); }
    catch { return false; }
    if (windows.length > 256) return false;
    if (this.current !== null && !windows.some(window => window.id === this.current?.windowId)) this.current = null;
    let closed = true;
    for (const window of windows) {
      if (!validId(window.id)) continue;
      const found = await ownership(window);
      if (found.kind === 'unknown') { if (this.current?.windowId === window.id) closed = false; continue; }
      if (found.kind === 'other') { if (this.current?.windowId === window.id) this.current = null; continue; }
      try {
        await chrome.windows.remove(window.id);
        if (this.current?.windowId === window.id) this.current = null;
      } catch {
        closed = false;
        this.current ??= { windowId: window.id, activation: found.activation! };
      }
    }
    return closed && this.current === null;
  }
}
