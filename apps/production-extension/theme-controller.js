// ADR-089: only an allowlisted appearance enum is persisted. No feature settings.
export const THEME_IDS = Object.freeze(['system', 'pearl', 'aurora', 'graphite', 'orchid', 'glass']);
export const THEME_STORAGE_KEY = 'ui-theme-v1';
export const normalizeTheme = value => typeof value === 'string' && THEME_IDS.includes(value) ? value : 'system';
const isTheme = value => typeof value === 'string' && THEME_IDS.includes(value);
const defaultCache = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const deadline = (promise, timeoutMs) => {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('theme-timeout')), timeoutMs); })]).finally(() => clearTimeout(timer));
};

export function createThemeController({ api = globalThis.browser ?? globalThis.chrome, root = globalThis.document?.documentElement, cache = defaultCache(), media = globalThis.matchMedia?.('(prefers-color-scheme: dark)'), bootstrap = null, timeoutMs = 1500 } = {}) {
  let id = normalizeTheme(root?.getAttribute?.('data-ui-theme')), ready = false, saving = 0, error = null, revision = 0, disposed = false;
  let initializing = null, queue = Promise.resolve(), transitionTimer = null, pendingNativeWrite = null, blockedWrite = false;
  const listeners = new Set();
  bootstrap?.claim();
  const effective = () => id === 'system' ? media?.matches ? 'system-dark' : 'system-light' : id;
  const snapshot = () => Object.freeze({ id, effectiveId: effective(), ready, saving: saving > 0, error });
  let current = snapshot();
  const notify = () => { current = snapshot(); for (const listener of [...listeners]) { try { listener(current); } catch { /* One view must not break another. */ } } };
  function apply(animate = false) {
    if (disposed) return;
    const next = effective(), changed = root?.getAttribute?.('data-ui-theme') !== id || root?.getAttribute?.('data-ui-theme-effective') !== next;
    if (animate && changed && root) {
      clearTimeout(transitionTimer);
      root.setAttribute('data-ui-theme-transition', 'true');
      transitionTimer = setTimeout(() => { root.removeAttribute('data-ui-theme-transition'); transitionTimer = null; }, 220);
    }
    root?.setAttribute('data-ui-theme', id); root?.setAttribute('data-ui-theme-effective', next);
    if (root) root.style.colorScheme = ['system-dark', 'aurora', 'graphite', 'glass'].includes(next) ? 'dark' : 'light';
    try { cache?.setItem(THEME_STORAGE_KEY, id); } catch { /* Optional first-paint mirror. */ }
    root?.setAttribute('data-ui-theme-ready', 'true');
  }
  const changed = (changes, area) => {
    if (disposed || area !== 'local' || !changes || !Object.hasOwn(changes, THEME_STORAGE_KEY)) return;
    revision++; id = normalizeTheme(changes[THEME_STORAGE_KEY]?.newValue); error = null;
    const animate = ready; ready = true; apply(animate); bootstrap?.finishLoading(); notify();
  };
  const systemChanged = () => { if (!disposed && id === 'system') { apply(ready); notify(); } };
  function initializeTheme() {
    if (initializing) return initializing;
    if (disposed) return Promise.reject(new Error('theme-closed'));
    api?.storage?.onChanged?.addListener(changed);
    media?.addEventListener?.('change', systemChanged);
    const before = revision;
    const read = Promise.resolve().then(() => api.storage.local.get(THEME_STORAGE_KEY)).then(value => ({ id: normalizeTheme(value?.[THEME_STORAGE_KEY]), ok: true }), () => ({ id, ok: false }));
    initializing = (async () => {
      let result;
      try {
        result = await deadline(read, timeoutMs);
      } catch { result = { id, ok: false }; }
      if (disposed) return;
      if (revision === before) { id = normalizeTheme(result.id); error = result.ok ? null : 'read-failed'; }
      const animate = ready; ready = true; apply(animate); bootstrap?.finishLoading(); notify();
      if (!result.ok) void read.then(late => {
        if (disposed || revision !== before || !late.ok) return;
        id = normalizeTheme(late.id); error = null; apply(true); notify();
      });
    })();
    return initializing;
  }
  function setTheme(value) {
    if (!isTheme(value)) return Promise.reject(new Error('invalid-theme'));
    if (disposed) return Promise.reject(new Error('theme-closed'));
    if (blockedWrite) return Promise.reject(new Error('theme-save-pending'));
    saving++; error = null; notify();
    const job = queue.then(async () => {
      await initializeTheme();
      if (disposed) throw new Error('theme-closed');
      if (blockedWrite) throw new Error('theme-save-pending');
      const before = revision;
      let write, timedOut = false;
      try {
        write = Promise.resolve().then(() => api.storage.local.set({ [THEME_STORAGE_KEY]: value }));
        pendingNativeWrite = write;
        const release = () => { if (pendingNativeWrite === write) { pendingNativeWrite = null; blockedWrite = false; } };
        void write.then(() => {
          release();
          if (timedOut && !disposed && revision === before) { revision++; id = value; error = null; apply(true); notify(); }
        }, release);
        await deadline(write, timeoutMs);
        if (disposed) return;
        if (revision === before) { revision++; id = value; apply(true); }
        error = null;
      } catch (failure) { if (pendingNativeWrite === write) { timedOut = true; blockedWrite = true; } if (!disposed) error = 'save-failed'; throw failure; }
    });
    queue = job.catch(() => {});
    return job.finally(() => { saving--; if (!disposed) notify(); });
  }
  return Object.freeze({
    getThemeSnapshot: () => current,
    subscribeTheme(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    initializeTheme, setTheme,
    dispose() { disposed = true; api?.storage?.onChanged?.removeListener(changed); media?.removeEventListener?.('change', systemChanged); clearTimeout(transitionTimer); root?.removeAttribute('data-ui-theme-transition'); listeners.clear(); },
  });
}

let shared;
function controller() {
  if (!shared) shared = createThemeController({ bootstrap: globalThis[Symbol.for('detect.expert/ui-theme-bootstrap/v1')] });
  return shared;
}
export const getThemeSnapshot = () => controller().getThemeSnapshot();
export const subscribeTheme = listener => controller().subscribeTheme(listener);
export const initializeTheme = () => controller().initializeTheme();
export const setTheme = id => controller().setTheme(id);
