// ADR-042: the header master uses the existing authorized scope route.
// Pausing does not delete a saved Pro recording or change the user's blocking policy.
import { redesignLabels } from './redesign-labels.js';
const RESUME_KEY = 'scope:resume-mode-v1';
const modes = new Set(['all-sites', 'site', 'active-tab']);
const request = async (api, type, fields = {}) => {
  const response = await api.runtime.sendMessage({ schemaVersion: 1, type, ...fields });
  if (!response || response.type === 'error') throw new Error('observation unavailable');
  return response;
};

export async function readObservationControl(api) {
  const consent = await request(api, 'ui-data-consent-get');
  const current = await request(api, 'ui-get-scope');
  if (typeof consent.accepted !== 'boolean' || current.type !== 'scope' || !current.scope) throw new Error('invalid observation state');
  return { enabled: consent.accepted && current.scope.scopeMode !== 'off', accepted: consent.accepted, scope: current.scope };
}

export async function setObservationControl(api, enabled, tabId = null) {
  let current = await readObservationControl(api);
  if (current.enabled === enabled) return current;
  if (!enabled) {
    await api.storage.local.set({ [RESUME_KEY]: { version: 1, scopeMode: current.scope.scopeMode } });
    await request(api, 'ui-set-scope', { scopeMode: 'off' });
  } else {
    if (!current.accepted) {
      await request(api, 'ui-data-consent-set', { version: 1, accepted: true });
      current = await readObservationControl(api);
    }
    if (!current.enabled || current.scope.scopeMode === 'active-tab') {
      const saved = (await api.storage.local.get(RESUME_KEY))[RESUME_KEY];
      const mode = saved?.version === 1 && modes.has(saved.scopeMode) ? saved.scopeMode : current.scope.grantedAllSites ? 'all-sites' : 'active-tab';
      const host = current.scope.hosts?.[0];
      if (mode === 'site' && !host) throw new Error('saved site unavailable');
      if (mode === 'active-tab') {
        if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('active tab unavailable');
        // The existing route owns document identity, activeTab grant and late injection.
        // Firefox's document guard stays authoritative; failure leaves the switch off.
        await request(api, 'ui-inject-now', { tabId });
      } else await request(api, 'ui-set-scope', { scopeMode: mode, ...(mode === 'site' ? { host } : {}) });
    }
  }
  const result = await readObservationControl(api);
  if (result.enabled !== enabled) throw new Error('observation change incomplete');
  return result;
}

export function createObservationControl({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome }) {
  return function ObservationControl({ tabId = null, labeled = false } = {}) {
    const locale = useLocale();
    const [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const alive = useRef(false), pending = useRef(false), revision = useRef(0), reading = useRef(false), queued = useRef(false);
    const refresh = async () => {
      const epoch = ++revision.current;
      if (reading.current || pending.current) { queued.current = true; return; }
      reading.current = true;
      try {
        const value = await readObservationControl(browserApi);
        if (alive.current && epoch === revision.current) setState(value);
      } catch { if (alive.current && epoch === revision.current) setError(true); }
      finally {
        reading.current = false;
        if (alive.current && queued.current && !pending.current) { queued.current = false; void refresh(); }
      }
    };
    useEffect(() => {
      alive.current = true;
      const changed = (changes, area) => {
        if ((area === 'local' && ('scope' in changes || 'data-consent:v1' in changes)) || (area === 'session' && 'data-consent:pending-v1' in changes)) void refresh();
      };
      browserApi.storage.onChanged.addListener(changed); void refresh();
      return () => { alive.current = false; revision.current++; browserApi.storage.onChanged.removeListener(changed); };
    }, []);
    const toggle = async () => {
      if (pending.current) return;
      if (!state || reading.current) { setError(false); await refresh(); return; }
      pending.current = true; revision.current++; setBusy(true); setError(false);
      try {
        let targetTabId = tabId;
        if (targetTabId === null && !state.enabled) {
          const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
          const target = tabs.find(tab => /^https?:\/\//.test(tab.url ?? ''));
          targetTabId = target?.id ?? null;
        }
        await setObservationControl(browserApi, !state.enabled, targetTabId);
      } catch { if (alive.current) setError(true); }
      finally {
        pending.current = false;
        if (alive.current) { queued.current = false; await refresh(); setBusy(false); }
      }
    };
    const control = h('button', { type: 'button', role: 'switch', class: 'observation-switch', 'data-observation-master': true,
      'aria-label': translate('observation_master_label'), 'aria-checked': state?.enabled === true,
      'aria-busy': busy || !state, disabled: busy || (!state && !error),
      title: translate(error ? 'consent_error' : state?.enabled ? 'observation_master_disable' : 'consent_enable'),
      onClick: toggle, children: h('span', { class: 'observation-switch__thumb', 'aria-hidden': true }) });
    const failure = error ? h('span', { class: 'observation-master__error', role: 'alert', title: translate('consent_error'), children: '!' }) : null;
    if (!labeled) return h('div', { class: 'observation-master', children: [control, failure] });
    // ADR-103: the popup names what the switch controls and shows its current scope.
    const labels = redesignLabels(locale), mode = state?.scope?.scopeMode;
    const scope = !state ? '' : !state.enabled ? labels.scopeOff : mode === 'all-sites' ? labels.scopeAll : mode === 'site' ? labels.scopeSite : mode === 'active-tab' ? labels.scopeTab : '';
    return h('div', { class: 'observation-master observation-master--labeled', children: [
      h('span', { class: 'observation-master__icon', 'aria-hidden': true, children: h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false', children: [
        h('path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }), h('circle', { cx: 12, cy: 12, r: 3 }) ] }) }),
      h('span', { class: 'observation-master__text', children: [h('strong', { children: labels.observation }), scope ? h('span', { class: 'observation-master__scope', 'data-observation-scope': mode ?? 'off', children: scope }) : null] }),
      control, failure
    ] });
  };
}
