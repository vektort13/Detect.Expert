// E22-08: typed, local WebRTC test profiles and an independently scoped native policy control.
import { validateWebRtcProfile } from './api-configuration.js';
import { antidetectEditorLabels } from './antidetect-editor-labels.js';
// Catalog 8: the literal host mode that shows a random <uuid>.local name instead of the local address (never valid for STUN or TURN).
export const WEBRTC_HOST_MDNS = 'mdns';
export const WEBRTC_PROFILE_DEFAULT = Object.freeze({ addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
const emptyFamily = () => ({ host: null, stun: null, turn: null });
const accepted = (family, role, value) => {
  const addresses = { ipv4: emptyFamily(), ipv6: emptyFamily() }; addresses[family][role] = value;
  return validateWebRtcProfile({ ...WEBRTC_PROFILE_DEFAULT, addresses }).ok;
};
/**
 * ADR-107: the one address check of every WebRTC address editor (the Antidetect Network level and the API Guard dialog). The
 * contract validator decides; this only names the problem: null (empty or valid), 'mdns' (the mode word typed as text),
 * 'family' (a valid address of the other family) or the family the field expects ('ipv4' | 'ipv6').
 */
export function webRtcAddressProblem(family, role, value) {
  if (value === null || value === undefined || value === '') return null;
  const expected = family === 'ipv6' ? 'ipv6' : 'ipv4';
  if (family !== expected || !['host', 'stun', 'turn'].includes(role) || typeof value !== 'string') return expected;
  if (role === 'host' && value === WEBRTC_HOST_MDNS) return null;
  if (accepted(family, role, value)) return null;
  if (value.trim().toLowerCase() === WEBRTC_HOST_MDNS) return 'mdns';
  return accepted(family === 'ipv4' ? 'ipv6' : 'ipv4', role, value) ? 'family' : expected;
}
export const WEBRTC_ADDRESS_ERROR_KEYS = Object.freeze({ ipv4: 'errorIpv4', ipv6: 'errorIpv6', family: 'errorFamily', mdns: 'errorMdns' });
/** The localized text of a problem; without a known locale the generic localized profile message is used. */
export function webRtcAddressMessage(problem, locale, translate) {
  if (!problem) return '';
  return typeof locale === 'string' && locale ? antidetectEditorLabels(locale)[WEBRTC_ADDRESS_ERROR_KEYS[problem] ?? 'errorIpv4'] : webRtcText(translate, 'invalid');
}
// Fields left at least once (each state update creates a new set; this one is never mutated).
const NO_FIELDS = new Set();
// The Options shell carries the chosen interface language; the API Guard dialog has no locale prop of its own.
// ADR-107: pressing another control blurs a field before that control's click, which follows the release. A message
// inserted at once moves the control from under the pointer and swallows the click, so while a pointer is pressed a
// field's mark waits for the release and one task more (after the click). Keyboard moves still mark at once.
const pointerPresses = new WeakMap(), POINTER_WAIT_LIMIT = 16;
/** Starts watching presses in the document of a focused field (once per document, capture phase, never removed). */
export function watchPointer(target) {
  const doc = target?.ownerDocument;
  if (!doc || typeof doc !== 'object' || typeof doc.addEventListener !== 'function' || pointerPresses.has(doc)) return;
  const press = { down: false, waiting: [] };
  const release = () => {
    press.down = false;
    const waiting = press.waiting.splice(0);
    if (waiting.length) setTimeout(() => { for (const run of waiting) { try { run(); } catch { /* One mark never blocks another. */ } } }, 0);
  };
  doc.addEventListener('pointerdown', () => { press.down = true; }, true);
  for (const type of ['pointerup', 'pointercancel', 'keydown']) doc.addEventListener(type, release, true);
  pointerPresses.set(doc, press);
}
/** Runs a blur mark now, or after the pressed pointer has been released and its click delivered. */
export function afterPointerRelease(target, run) {
  const doc = target?.ownerDocument, press = doc && typeof doc === 'object' ? pointerPresses.get(doc) : undefined;
  if (press?.down && press.waiting.length < POINTER_WAIT_LIMIT) press.waiting.push(run); else run();
}
const shellLocale = () => { try { return globalThis.document?.querySelector?.('.management-shell[lang]')?.getAttribute('lang') || null; } catch { return null; } };
const COPY = Object.freeze({
  network_title: 'WebRTC network policy', network_scope: 'Applies to the whole browser, independently of API modes and sites.',
  policy_system: 'Browser settings', policy_public: 'Public interface only', policy_udp: 'Disable UDP outside proxy', effective: 'Effective policy',
  inactive: 'Browser settings unchanged', permission_required: 'Permission required', unsupported: 'Not available in this browser', error: 'Could not apply the policy', applied: 'Policy applied', not_controllable: 'Controlled by another extension or administrator',
  grant: 'Enable network policy access', refresh: 'Refresh status', denied: 'The permission was not granted.', refresh_error: 'Could not refresh the network policy.',
  addresses: 'Custom ICE addresses', host: 'Host address', stun: 'STUN address (srflx)', turn: 'TURN address (relay)', address_note: 'Changes addresses reported to JavaScript; the network route and source IP stay unchanged.',
  transport: 'ICE transport', preserve: "Keep the site's setting", relay: 'Relay only', relay_note: "Uses the site's TURN servers.",
  devices: 'Randomize device identifiers', lifetime: 'Device identifier lifetime', session: 'Browser session', site: 'Site', certificates: 'Fresh DTLS certificate for each connection',
  profile_title: 'WebRTC', profile_configure: 'Configure WebRTC', profile_addresses: 'STUN / TURN · IPv4 / IPv6', profile_devices: 'Devices', profile_certificates: 'DTLS certificates', profile_save: 'Save and use Custom', search_terms: 'WebRTC STUN TURN ICE IPv4 IPv6 IP devices device identifiers certificates DTLS',
  invalid: 'Check the WebRTC profile. Each enabled address must be a literal IPv4 or IPv6 address.', no_addresses: 'Original addresses', permission_save: 'Enable network policy access before saving this policy.', conflict: 'Choose either a custom device list or randomized device identifiers.',
  host_mdns: 'mDNS name (.local)', host_mdns_note: 'Hides the local address behind a random .local name, like Chrome without camera access. No name is resolved and the network route stays unchanged.',
  policy_proxy_only: 'Proxy only (Firefox)', proxy_only_note: 'Sends every WebRTC connection through the proxy and nothing directly. Calls and video chats fail if no proxy carries UDP. Firefox only.'
});
/**
 * The browser-wide native policies, weakest to strictest. 'proxy_only' exists only in Firefox's privacy API (every WebRTC connection must go
 * through a proxy, so calls fail when none carries UDP); a Chrome build neither offers nor applies it.
 */
export const WEBRTC_NETWORK_POLICIES = Object.freeze(['system', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only']);
const POLICY_LABEL_KEYS = Object.freeze({ system: 'policy_system', default: 'policy_system', default_public_interface_only: 'policy_public', disable_non_proxied_udp: 'policy_udp', proxy_only: 'policy_proxy_only' });
/** The label key of a policy value (the browser's own 'default' reads as System); null for anything else. */
export function webRtcPolicyLabelKey(policy) { return typeof policy === 'string' && Object.hasOwn(POLICY_LABEL_KEYS, policy) ? POLICY_LABEL_KEYS[policy] : null; }
/** True in a Firefox build: its extension pages live at moz-extension:// (the only browser whose privacy API has the extra value). */
export function webRtcFirefoxBuild(api = globalThis.browser ?? globalThis.chrome) { try { return api?.runtime?.getURL?.('').startsWith('moz-extension:') === true; } catch { return false; } }
/**
 * The policies a picker lists: the three shared ones everywhere; 'proxy_only' only in a Firefox build, or while it is the saved choice
 * (a select must never show another value for it - the status then reads "not available in this browser" and the picker is locked).
 */
export function webRtcPolicyChoices({ firefox = false, current = 'system' } = {}) { return WEBRTC_NETWORK_POLICIES.filter(policy => policy !== 'proxy_only' || firefox === true || current === 'proxy_only'); }
export function webRtcText(translate, key) { const id = 'protection_webrtc_' + key, result = translate?.(id); return result && result !== id ? result : COPY[key] ?? key; }
export function readWebRtcNetworkState(raw) {
  const policies = WEBRTC_NETWORK_POLICIES, statuses = ['inactive', 'permission-required', 'unsupported', 'error', 'applied', 'not-controllable'];
  if (!raw || !policies.includes(raw.desired) || !statuses.includes(raw.status) || raw.value !== null && (typeof raw.value !== 'string' || raw.value.length > 128) || raw.levelOfControl !== null && !['not_controllable', 'controlled_by_other_extensions', 'controllable_by_this_extension', 'controlled_by_this_extension'].includes(raw.levelOfControl)) return { desired: 'system', status: 'unsupported', value: null, levelOfControl: null };
  return { desired: raw.desired, status: raw.status, value: raw.value, levelOfControl: raw.levelOfControl };
}
export function formatWebRtcProfile(value, translate) {
  const t = key => webRtcText(translate, key);
  const parts = [value?.addresses ? ['ipv4', 'ipv6'].flatMap(family => ['host', 'stun', 'turn'].filter(key => value.addresses[family]?.[key] !== null).map(key => family.toUpperCase() + ' ' + key.toUpperCase() + ': ' + (key === 'host' && value.addresses[family]?.host === WEBRTC_HOST_MDNS ? t('host_mdns') : value.addresses[family]?.[key] ?? ''))).join(' · ') : t('no_addresses'), t(value?.iceTransportPolicy === 'relay' ? 'relay' : 'preserve')];
  if (value?.randomizeDevices) parts.push(t('devices') + ': ' + t(value.deviceLifetime === 'site' ? 'site' : 'session'));
  if (value?.freshCertificates) parts.push(t('certificates'));
  return parts.join(' · ');
}
export function createWebRtcConfigurationUi({ h, useState, useEffect, useRef, translate }) {
  const t = key => webRtcText(translate, key);
  // Feature titles remain descriptive in every mode; dormant saved values are not shown as active.
  function WebRtcProfileOverview({ disabled = false, onConfigure }) {
    const icon = kind => h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: kind === 'addresses'
      ? [h('circle', { cx: 12, cy: 5, r: 3 }), h('circle', { cx: 5, cy: 19, r: 3 }), h('circle', { cx: 19, cy: 19, r: 3 }), h('path', { d: 'm10.7 7.7-4.4 8.6m7-8.6 4.4 8.6M8 19h8' })]
      : kind === 'devices' ? [h('rect', { x: 3, y: 4, width: 15, height: 12, rx: 2 }), h('path', { d: 'M7 20h7m-3.5-4v4' }), h('rect', { x: 17, y: 12, width: 5, height: 9, rx: 1.5 })]
        : [h('path', { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8m0-18 6 6v4M14 3v6h6' }), h('circle', { cx: 17, cy: 16, r: 3 }), h('path', { d: 'm15 18.3-.5 3.7 2.5-1.5 2.5 1.5-.5-3.7' })] });
    return h('section', { class: 'webrtc-profile-overview', 'data-webrtc-profile-overview': true, 'aria-label': t('profile_title'), children: [
      h('div', { class: 'webrtc-profile-overview__heading', children: [h('h2', { children: t('profile_title') }), h('button', { type: 'button', class: 'button button--primary webrtc-profile-overview__configure', disabled, onClick: onConfigure, 'aria-haspopup': 'dialog', 'data-webrtc-configure': true, children: t('profile_configure') })] }),
      h('ul', { class: 'webrtc-profile-overview__features', children: ['addresses', 'devices', 'certificates'].map(kind => h('li', { key: kind, 'data-webrtc-profile-feature': kind, children: [h('span', { class: 'webrtc-profile-overview__icon', children: icon(kind) }), h('span', { children: t('profile_' + kind) })] })) })
    ] });
  }
  function WebRtcProfileFields({ value, onChange, disabled = false, locale = null }) {
    const profile = value && typeof value === 'object' ? value : WEBRTC_PROFILE_DEFAULT, remembered = useRef(null), literalHosts = useRef({ ipv4: null, ipv6: null });
    const [touched, setTouched] = useState(NO_FIELDS);
    if (profile.addresses) remembered.current = profile.addresses;
    const addresses = profile.addresses ?? remembered.current ?? { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } };
    const language = typeof locale === 'string' && locale ? locale : shellLocale();
    const change = patch => { if (!disabled) onChange({ ...profile, ...patch }); };
    const mdns = family => addresses[family]?.host === WEBRTC_HOST_MDNS;
    // The mDNS choice replaces only the Host slot of its family; the literal typed before is kept in memory so unchecking restores it.
    function toggleMdns(family, checked) {
      if (checked && !mdns(family)) literalHosts.current[family] = addresses[family]?.host ?? null;
      change({ addresses: { ...addresses, [family]: { ...addresses[family], host: checked ? WEBRTC_HOST_MDNS : literalHosts.current[family] } } });
    }
    // ADR-107: a field is checked when it loses focus; the message then follows every edit, so a fix clears it at once.
    function addressRow(family, key) {
      const hidden = key === 'host' && mdns(family), name = family + ':' + key, id = 'webrtc-address-' + family + '-' + key, errorId = id + '-error';
      const problem = !hidden && touched.has(name) ? webRtcAddressProblem(family, key, addresses[family]?.[key] ?? null) : null;
      return h('div', { key, class: 'webrtc-config-address', children: [
        h('label', { for: id, children: t(key) }),
        h('input', { id, type: 'text', dir: 'ltr', value: hidden ? '' : addresses[family]?.[key] ?? '', disabled: disabled || hidden, placeholder: hidden ? t('host_mdns') : family === 'ipv4' ? '192.0.2.10' : '2001:db8::10', maxLength: family === 'ipv4' ? 15 : 45, spellcheck: false, autoComplete: 'off', autoCapitalize: 'off',
          'aria-invalid': problem ? 'true' : undefined, 'aria-describedby': problem ? errorId : undefined, 'data-webrtc-field': name, onFocus: event => watchPointer(event?.currentTarget),
          onBlur: event => afterPointerRelease(event?.currentTarget, () => setTouched(current => current.has(name) ? current : new Set([...current, name]))), onInput: event => {
            // Typing the word mdns must not silently switch the mode: the mode has its own checkbox, so the draft stays an invalid literal until Save rejects it.
            const text = event.currentTarget.value;
            change({ addresses: { ...addresses, [family]: { ...addresses[family], [key]: key === 'host' && text === WEBRTC_HOST_MDNS ? text + ' ' : text || null } } });
          } }),
        problem ? h('span', { id: errorId, class: 'webrtc-config-error', 'data-webrtc-field-error': name, children: webRtcAddressMessage(problem, language, translate) }) : null,
      ] });
    }
    // One note explains the mDNS choice of both families; each checkbox points at it.
    const hostChoice = family => h('label', { key: 'host-mdns', class: 'webrtc-config-check webrtc-config-mdns', children: [h('input', { type: 'checkbox', checked: mdns(family), disabled, 'aria-describedby': 'webrtc-mdns-note', 'data-webrtc-field': family + '-mdns', onChange: event => toggleMdns(family, event.currentTarget.checked) }), h('span', { children: t('host_mdns') })] });
    const checkbox = (key, checked, onChange, text = t(key)) => h('label', { class: 'webrtc-config-check', children: [h('input', { type: 'checkbox', checked, disabled, 'data-webrtc-field': key, onChange: event => onChange(event.currentTarget.checked) }), h('span', { children: text })] });
    const enabledText = (() => { if (language) return antidetectEditorLabels(language).addressesUse; const own = translate?.('antidetect_addresses_enabled'); return own && own !== 'antidetect_addresses_enabled' ? own : antidetectEditorLabels('en').addressesUse; })();
    return h('div', { class: 'webrtc-config-fields', 'data-webrtc-profile-fields': true, children: [
      h('fieldset', { class: 'webrtc-config-section', disabled, children: [h('legend', { children: t('addresses') }),
        checkbox('addresses', profile.addresses !== null, enabled => change({ addresses: enabled ? remembered.current ?? { ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } } : null }), enabledText),
        h('div', { class: 'webrtc-config-addresses', children: ['ipv4', 'ipv6'].map(family => h('fieldset', { class: 'webrtc-config-section webrtc-config-family', key: family, disabled, 'data-webrtc-family': family, children: [h('legend', { dir: 'ltr', children: family === 'ipv4' ? 'IPv4' : 'IPv6' }), addressRow(family, 'host'), hostChoice(family), addressRow(family, 'stun'), addressRow(family, 'turn')] })) }),
        h('p', { id: 'webrtc-mdns-note', class: 'webrtc-config-note webrtc-config-mdns-note', 'data-webrtc-mdns-note': true, children: t('host_mdns_note') }),
        profile.addresses ? h('p', { class: 'webrtc-config-note', children: t('address_note') }) : null
      ] }),
      h('label', { children: [t('transport'), h('select', { value: profile.iceTransportPolicy, disabled, 'data-webrtc-field': 'iceTransportPolicy', onChange: event => change({ iceTransportPolicy: event.currentTarget.value }), children: [h('option', { value: 'preserve', children: t('preserve') }), h('option', { value: 'relay', children: t('relay') })] }), profile.iceTransportPolicy === 'relay' ? h('small', { children: t('relay_note') }) : null] }),
      h('fieldset', { class: 'webrtc-config-section', disabled, children: [h('legend', { children: t('profile_devices') }), checkbox('devices', profile.randomizeDevices, checked => change({ randomizeDevices: checked })),
        profile.randomizeDevices ? h('label', { children: [t('lifetime'), h('select', { value: profile.deviceLifetime, disabled, 'data-webrtc-field': 'deviceLifetime', onChange: event => change({ deviceLifetime: event.currentTarget.value }), children: [h('option', { value: 'session', children: t('session') }), h('option', { value: 'site', children: t('site') })] })] }) : null
      ] }),
      checkbox('certificates', profile.freshCertificates, checked => change({ freshCertificates: checked }))
    ] });
  }
  function WebRtcNetworkPolicyPanel({ value = 'system', network, disabled = false, onChange, onGrant, onRefresh, firefox = webRtcFirefoxBuild() }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), active = useRef(false), mounted = useRef(false), current = readWebRtcNetworkState(network);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function act(task) {
      if (active.current) return; active.current = true; setBusy(true); setError('');
      try { await task(); } catch (failure) { if (mounted.current) setError(t(failure?.code === 'permission-denied' ? 'denied' : 'refresh_error')); }
      finally { active.current = false; if (mounted.current) setBusy(false); }
    }
    const policyLabel = policy => { const key = webRtcPolicyLabelKey(policy); return key ? t(key) : policy; };
    return h('section', { class: 'webrtc-network-policy', 'data-webrtc-network-policy': true, 'aria-busy': busy, children: [
      h('div', { class: 'webrtc-network-policy__heading', children: [h('strong', { children: t('network_title') }), h('p', { class: 'webrtc-config-note', children: t('network_scope') })] }),
      h('label', { class: 'webrtc-network-policy__picker', children: [t('network_title'), h('select', { class: 'api-config-select', value, disabled: disabled || busy || current.status === 'unsupported', 'data-webrtc-network-policy-picker': true, onChange: event => onChange(event.currentTarget.value), children: webRtcPolicyChoices({ firefox, current: value }).map(policy => h('option', { key: policy, value: policy, children: policyLabel(policy) })) })] }),
      value === 'proxy_only' ? h('p', { class: 'webrtc-config-note', 'data-webrtc-proxy-only-note': true, children: t('proxy_only_note') }) : null,
      h('p', { class: 'webrtc-network-policy__status', role: current.status === 'error' || current.status === 'not-controllable' ? 'alert' : 'status', 'data-webrtc-network-status': current.status, children: t(current.status.replaceAll('-', '_')) }),
      current.value !== null ? h('p', { class: 'webrtc-config-note', 'data-webrtc-network-effective': true, children: [t('effective') + ': ', h('span', { children: policyLabel(current.value) })] }) : null,
      h('div', { class: 'blocking-actions', children: [current.status === 'permission-required' || value !== 'system' && current.status === 'inactive' && current.levelOfControl === null ? h('button', { type: 'button', class: 'button', disabled: disabled || busy, 'data-webrtc-network-grant': true, onClick: () => act(onGrant), children: t('grant') }) : null,
        h('button', { type: 'button', class: 'button button--text', disabled: disabled || busy, 'data-webrtc-network-refresh': true, onClick: () => act(onRefresh), children: t('refresh') })] }),
      error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null
    ] });
  }
  return { WebRtcProfileOverview, WebRtcProfileFields, WebRtcNetworkPolicyPanel };
}
