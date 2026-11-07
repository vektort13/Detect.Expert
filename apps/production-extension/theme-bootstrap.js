// ADR-089: synchronous, validated UI-only cache before styles/first paint.
(() => {
  const slot = Symbol.for('detect.expert/ui-theme-bootstrap/v1');
  if (globalThis[slot]) return;
  const ids = Object.freeze(['system', 'pearl', 'aurora', 'graphite', 'orchid', 'glass']);
  const key = 'ui-theme-v1', root = globalThis.document?.documentElement;
  const valid = value => typeof value === 'string' && ids.includes(value);
  let cache, initialId = 'system', claimed = false, timer = null;
  try { cache = globalThis.localStorage; const value = cache.getItem(key); if (valid(value)) initialId = value; } catch { /* Storage can be disabled. */ }
  const finishLoading = () => { if (timer !== null) clearTimeout(timer); timer = null; root?.removeAttribute('data-ui-theme-loading'); };
  function apply(id) {
    const dark = id === 'system' ? Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches) : ['aurora', 'graphite', 'glass'].includes(id);
    root?.setAttribute('data-ui-theme', id);
    root?.setAttribute('data-ui-theme-effective', id === 'system' ? dark ? 'system-dark' : 'system-light' : id);
    if (root) root.style.colorScheme = dark ? 'dark' : 'light';
    try { cache?.setItem(key, id); } catch { /* The browser setting remains authoritative. */ }
  }
  apply(initialId);
  root?.setAttribute('data-ui-theme-loading', 'true');
  let deadline;
  const fallback = new Promise(resolve => { deadline = setTimeout(() => resolve({ id: initialId, ok: false }), 300); });
  const read = (async () => {
    try {
      const api = globalThis.browser ?? globalThis.chrome;
      if (!api?.storage?.local?.get) return { id: initialId, ok: false };
      const value = await api.storage.local.get(key);
      return { id: valid(value?.[key]) ? value[key] : 'system', ok: true };
    } catch { return { id: initialId, ok: false }; }
  })();
  const initialRead = Promise.race([read, fallback]).then(result => {
    clearTimeout(deadline);
    if (!claimed) { apply(result.id); finishLoading(); }
    return Object.freeze(result);
  });
  void read.then(result => { if (!claimed && result.ok) { apply(result.id); finishLoading(); } });
  timer = setTimeout(finishLoading, 350);
  Object.defineProperty(globalThis, slot, { value: Object.freeze({ ids, key, initialRead, nativeRead: read, claim: () => { claimed = true; }, finishLoading }), configurable: false, writable: false });
})();
