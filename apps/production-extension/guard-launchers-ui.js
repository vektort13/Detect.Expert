// E22-22: launcher controls delegate all settings changes to the shared CAS controller.
import { createGuardLauncherController } from './guard-launcher-controller.js';
import { openManagement } from './management-navigation.js';

export function guardLauncherHasFirewall(browserApi) {
  try { const permissions = browserApi.runtime.getManifest().permissions; return Array.isArray(permissions) && permissions.includes('declarativeNetRequestWithHostAccess'); }
  catch { return false; }
}

export function createGuardLaunchersUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome }) {
  const text = key => translate('guard_launcher_' + key);
  const validTab = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
  const statusChildren = enabled => [h('span', { class: 'blocking-master__dot', 'aria-hidden': 'true' }), h('span', { children: enabled ? 'ON' : 'OFF' })];

  function AntidetectLauncher({ tabId = null }) {
    useLocale();
    const mounted = useRef(false), openingRef = useRef(false), controller = useRef(null);
    const [view, setView] = useState({ enabled: null, busy: false, error: null });
    const [opening, setOpening] = useState(false), [openError, setOpenError] = useState(false);
    useEffect(() => {
      mounted.current = true;
      const current = createGuardLauncherController(browserApi, { masterKey: 'antidetectEnabled', onChange: next => { if (mounted.current) setView(next); } });
      controller.current = current;
      setView(current.getState());
      void current.load();
      return () => { mounted.current = false; controller.current = null; current.dispose(); };
    }, []);
    async function open() {
      if (!mounted.current || openingRef.current || !validTab(tabId)) return;
      openingRef.current = true; setOpening(true); setOpenError(false);
      try {
        if (!await openManagement('antidetect', tabId, browserApi)) throw Error('management-unavailable');
      } catch { if (mounted.current) setOpenError(true); }
      finally { openingRef.current = false; if (mounted.current) setOpening(false); }
    }
    const enabled = view.enabled === true;
    return h('section', { class: 'blocking-launcher guard-launcher', 'data-antidetect-launcher': true, 'aria-busy': view.busy || opening || view.enabled === null, children: [
      h('div', { class: 'blocking-launcher__controls', children: [
        h('button', { type: 'button', class: 'blocking-launcher__open', 'data-antidetect-open': true, 'aria-label': text('antidetect_open'), disabled: opening, onClick: open, children: [h('span', { children: 'Antidetect' }), h('span', { class: 'blocking-launcher__chevron', 'aria-hidden': 'true', children: '›' })] }),
        h('button', { type: 'button', class: 'blocking-master ' + (enabled ? 'blocking-master--on' : 'blocking-master--off'), role: 'switch', 'aria-checked': enabled, 'aria-label': text('antidetect_master'), 'data-antidetect-launcher-master': true, disabled: view.busy || view.enabled === null, onClick: () => controller.current?.toggle(), children: statusChildren(enabled) })
      ] }),
      view.error || openError ? h('p', { class: 'blocking-message blocking-message--error', role: 'alert', children: text(openError ? 'open_error' : 'error') }) : null
    ] });
  }

  function UnavailableLauncher({ name, reason, attribute, soon = false }) {
    return h('section', { class: 'blocking-launcher guard-launcher guard-launcher--unavailable' + (soon ? ' guard-launcher--soon' : ''), [attribute]: true, children: h('div', { class: 'blocking-launcher__controls', title: reason, children: [
      h('button', { type: 'button', class: 'blocking-launcher__open', disabled: true, 'aria-label': name + ': ' + reason, children: h('span', { children: name }) }),
      h('button', { type: 'button', class: 'blocking-master blocking-master--off', role: 'switch', 'aria-checked': false, 'aria-label': name + ': ' + reason, disabled: true, children: statusChildren(false) }),
      // ADR-103: a planned module shows a word, not a disabled switch.
      soon ? h('span', { class: 'guard-launcher__soon', 'aria-hidden': 'true', children: reason }) : null
    ] }) });
  }
  function DpiGuardLauncher() {
    useLocale();
    return h(UnavailableLauncher, { name: 'DPI Guard', reason: text('coming_soon'), attribute: 'data-dpi-guard-launcher', soon: true });
  }
  function UnavailableFirewallLauncher() {
    useLocale();
    return h(UnavailableLauncher, { name: 'Firewall', reason: text('firewall_unavailable'), attribute: 'data-firewall-unavailable-launcher' });
  }
  return { AntidetectLauncher, DpiGuardLauncher, UnavailableFirewallLauncher };
}
