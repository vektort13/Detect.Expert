// ADR-070/103/107 round 5: the route card of the Proxy manager. It sits in the module header (the shared workspace master card):
// the state as icon plus word, the profile the route uses, Connect or Disconnect, the quiet protections strip (Kill Switch fixed on,
// WebRTC, network prediction, start-up connection, routing mode) with one honest sentence each, and three disclosure sections:
// routing domain lists (chips with validation), the connection analyzer, and the companion. Presentation only; every action and
// every value is the view model `m` of proxy-ui.js. Nothing here renders a credential.
import { proxyEndpointLabel, PROXY_TYPES, PROXY_PHASES, PROXY_COMPANION_DOWNLOAD_URL } from './proxy-shared.js';
import { TYPE_LABELS } from './proxy-list-ui.js';

const STATE_GLYPHS = Object.freeze({ off: 'unknown', connecting: 'pending', connected: 'pass', blocked: 'fail', error: 'fail', conflict: 'warning', 'permission-required': 'warning' });
const DOMAIN_REASONS = Object.freeze({ invalid: 'domain_invalid', duplicate: 'domain_taken', conflict: 'domain_taken' });

export function createProxyRouteUi({ h, t, c, icons, list }) {
  const { icon, badgeIcon } = icons, { button, typePill, countryChip } = list;
  const stateWord = state => t('state_' + state.replaceAll('-', '_'));

  // ---- Summary ---------------------------------------------------------------------------------------------------------------------
  const stateChip = m => h('span', { class: 'pm-state pm-state--' + m.state, role: 'status', 'data-proxy-state': m.state, children: [badgeIcon(STATE_GLYPHS[m.state] ?? 'unknown'), h('span', { children: stateWord(m.state) })] });
  function summary(m) {
    const profile = m.selectedProfile;
    const name = profile ? m.profiles.find(item => item.id === m.snapshot?.status?.profileId)?.name ?? profile.name : null;
    const address = profile ? proxyEndpointLabel(profile.host, profile.port) : '';
    return h('div', { class: 'pm-route-line', children: [
      stateChip(m),
      profile ? h('div', { class: 'pm-route-profile', 'data-proxy-route-profile': profile.id, children: [
        h('span', { class: 'pm-avatar pm-type--' + profile.type, 'aria-hidden': 'true', children: icon(profile.type, 18) }),
        h('div', { class: 'pm-route-text', children: [h('strong', { class: 'pm-route-name', dir: 'auto', children: name }), h('span', { class: 'pm-route-sub', children: [typePill(profile.type), address ? h('span', { class: 'pm-mono', dir: 'ltr', children: address }) : null, countryChip(m, profile)] })] }),
      ] }) : m.configuration ? h('span', { class: 'pm-route-hint', id: 'proxy-setup-hint', 'data-proxy-setup-hint': true, children: t(m.profiles.length ? 'choose_profile' : 'setup_required') }) : h('strong', { class: 'pm-route-hint', children: '—' }),
      modeSwitch(m),
      profile ? h('div', { class: 'pm-route-actions', children: m.proxyEnabled
        ? button(t('disconnect'), { disabled: m.disconnectDisabled, 'data-proxy-route-disconnect': true, onClick: () => m.disconnect() }, 'disconnect')
        : button(t('connect'), { class: 'button button--primary', disabled: m.busy || !m.configuration || m.state === 'connecting', 'data-proxy-route-connect': true, onClick: () => m.connectSelected() }, 'connect') }) : null,
    ] });
  }

  // All browser traffic, or only the selected domains: a draft that Save applies, like the toggles.
  function modeSwitch(m) {
    const s = m.settings, editable = !m.busy && Boolean(s);
    return h('fieldset', { class: 'pm-mode', disabled: !editable, children: [h('legend', { class: 'proxy-workspace-sr', children: t('routing') }), h('div', { class: 'pm-seg pm-seg--mode', role: 'presentation', children: ['all', 'include'].map(mode => h('label', { class: 'pm-seg-btn' + (s?.routing?.mode === mode ? ' is-on' : ''), children: [h('input', { type: 'radio', class: 'pm-seg-input', name: 'proxy-routing-mode', value: mode, checked: s?.routing?.mode === mode, 'data-proxy-route-mode': mode, onChange: () => m.changeRouting('mode', mode) }), h('span', { children: t(mode === 'all' ? 'all_traffic' : 'selected_domains') })] })) })] });
  }

  // ---- Protections strip ---------------------------------------------------------------------------------------------------------------
  // The toggles edit a draft that Save applies, so they are checkboxes (drawn as switches), not instant switches.
  function toggle({ key, glyph, title, detail, checked, disabled, onChange, attr }) {
    const id = 'pm-tile-' + key;
    return h('label', { class: 'pm-tile' + (disabled ? ' is-fixed' : ''), 'data-proxy-tile': key, children: [
      h('span', { class: 'pm-tile-icon', 'aria-hidden': 'true', children: icon(glyph, 18) }),
      h('span', { class: 'pm-tile-text', children: [h('strong', { class: 'pm-tile-title', id: id + '-title', children: title }), detail ? h('small', { class: 'pm-tile-detail', id: id + '-detail', children: detail }) : null] }),
      h('span', { class: 'pm-toggle', children: [h('input', { type: 'checkbox', class: 'pm-toggle-input', checked, disabled, 'aria-labelledby': id + '-title', 'aria-describedby': detail ? id + '-detail' : undefined, ...attr, onChange }), h('span', { class: 'pm-toggle-track', 'aria-hidden': 'true' })] }),
    ] });
  }
  function protections(m) {
    const s = m.settings, editable = !m.busy && Boolean(s);
    const setting = (key, glyph, title, detail) => toggle({ key, glyph, title, detail, checked: s?.[key] === true, disabled: !editable, attr: { 'data-proxy-setting': key }, onChange: event => m.changeSetting(key, event.currentTarget.checked) });
    return h('div', { class: 'pm-protect', role: 'group', 'aria-label': t('protections'), children: [
      toggle({ key: 'kill', glyph: 'lock', title: t('kill_switch'), detail: t('kill_switch_detail'), checked: s?.killSwitch === true, disabled: true, attr: { 'data-proxy-kill-switch': true } }),
      setting('protectWebRTC', 'shield', t('protect_webrtc'), t('protect_webrtc_detail')),
      setting('disablePrediction', 'droplet', t('disable_prediction'), t('disable_prediction_detail')),
      setting('autoConnect', 'connect', t('auto_connect'), null),
    ] });
  }
  function saveBar(m) {
    if (!m.settingsDirty) return null;
    return h('div', { class: 'pm-savebar', role: 'group', 'aria-label': t('unsaved'), 'data-proxy-savebar': true, children: [
      icon('info', 16), h('span', { class: 'pm-savebar-text', children: t('unsaved') }),
      h('div', { class: 'pm-savebar-actions', children: [button(c('cancel'), { disabled: m.busy, 'data-proxy-discard-settings': true, onClick: () => m.discardSettings() }), button(c('save'), { class: 'button button--primary', disabled: m.busy || !m.settings, 'data-proxy-save-settings': true, onClick: () => m.saveSettings() })] }),
    ] });
  }

  // ---- Domain chips ----------------------------------------------------------------------------------------------------------------------
  function domainEditor(m, key, label, note) {
    const items = m.settings?.routing?.[key] ?? [], draft = m.domainDrafts[key] ?? '', error = m.domainError?.key === key ? m.domainError.reason : null, id = 'pm-domains-' + key, errorId = id + '-error';
    return h('div', { class: 'pm-domains', 'data-proxy-domain-list': key, children: [
      h('label', { class: 'pm-field-label', for: id + '-input', children: label }),
      h('div', { class: 'pm-chipbox' + (error ? ' has-error' : ''), children: [
        h('ul', { class: 'pm-domain-chips', 'data-proxy-domains': key, 'aria-label': label, children: items.map(value => h('li', { key: value, class: 'pm-domain', 'data-proxy-domain': value, children: [h('bdi', { dir: 'ltr', class: 'pm-mono', children: value }), h('button', { type: 'button', class: 'pm-domain-remove', disabled: m.busy, 'aria-label': t('domain_remove') + ': ' + value, 'data-proxy-domain-remove': value, onClick: () => m.removeDomain(key, value), children: icon('close', 12) })] })) }),
        h('input', { type: 'text', class: 'pm-domain-input', id: id + '-input', value: draft, dir: 'ltr', spellcheck: false, autoComplete: 'off', placeholder: t('domain_add'), disabled: m.busy || !m.settings, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': (error ? errorId + ' ' : '') + (note ? id + '-note' : ''), maxLength: 253, 'data-proxy-domain-input': key, onInput: event => m.setDomainDraft(key, event.currentTarget.value), onKeyDown: event => m.onDomainKey(event, key), onBlur: () => m.commitDomains(key) }),
      ] }),
      error ? h('p', { class: 'pm-error', id: errorId, role: 'alert', 'data-proxy-domain-error': key, children: [badgeIcon('fail'), h('span', { children: error === 'limit' ? c('invalid_input') : t(DOMAIN_REASONS[error] ?? 'domain_invalid') })] }) : null,
      note ? h('p', { class: 'pm-note', id: id + '-note', 'data-proxy-direct-note': key === 'directDomains' ? true : undefined, children: note }) : null,
    ] });
  }
  function routingPanel(m) {
    return h('div', { class: 'pm-panel', id: 'pm-panel-routing', role: 'region', 'aria-label': t('routing'), 'data-proxy-panel-body': 'routing', children: [
      h('div', { class: 'pm-panel-head', children: [h('span', { class: 'pm-pill pm-pill--info', children: [badgeIcon('pass'), t('remote_dns')] })] }),
      h('div', { class: 'pm-domain-grid', children: [domainEditor(m, 'proxyDomains', t('proxy_domains'), null), domainEditor(m, 'directDomains', t('direct_domains'), t('direct_domains_detail'))] }),
      h('label', { class: 'pm-checkrow', children: [h('input', { type: 'checkbox', checked: m.settings?.routing?.bypassLocal === true, disabled: m.busy || !m.settings, 'data-proxy-local': true, onChange: event => m.changeRouting('bypassLocal', event.currentTarget.checked) }), h('span', { children: t('bypass_local') })] }),
      h('div', { class: 'pm-panel-actions', children: button(c('grant'), { disabled: m.busy, 'data-proxy-grant-privacy': true, onClick: () => m.grantPrivacy() }, 'shield') }),
    ] });
  }

  // ---- Analyzer --------------------------------------------------------------------------------------------------------------------
  function analyzerPanel(m) {
    const connected = m.state === 'connected' && m.configuration?.enabled === true, result = m.checkResult;
    return h('div', { class: 'pm-panel pm-analyzer', id: 'pm-panel-analyzer', role: 'region', 'aria-label': t('analyzer'), 'data-proxy-analyzer': true, 'data-proxy-panel-body': 'analyzer', children: [
      h('div', { class: 'pm-panel-head', children: result ? h('span', { class: 'pm-pill pm-check pm-check--' + (result.state === 'pass' ? 'pass' : 'fail'), role: 'status', 'data-proxy-check-state': result.state, children: [badgeIcon(result.state === 'pass' ? 'pass' : 'fail'), h('span', { children: t(result.state === 'pass' ? 'check_pass' : 'check_fail') })] }) : null }),
      h('div', { class: 'pm-row2 pm-row2--end', children: [
        h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('target_url') }), h('input', { type: 'url', class: 'pm-input', value: m.checkTarget, dir: 'ltr', maxLength: 2048, spellcheck: false, autoComplete: 'off', disabled: m.busy, 'data-proxy-check-target': true, onInput: event => m.setCheckTarget(event.currentTarget.value) })] }),
        button(t(m.checking ? 'checking' : 'check_connection'), { class: 'button button--primary', disabled: m.busy || !connected, 'data-proxy-check': true, onClick: () => m.diagnoseConnection() }, 'proxy'),
      ] }),
      result?.state === 'pass' ? h('dl', { class: 'pm-results', 'data-proxy-check-results': true, children: [
        h('div', { children: [h('dt', { children: t('remote_ip') }), h('dd', { dir: 'ltr', 'data-proxy-check-ip': true, children: result.ip ?? '—' })] }),
        h('div', { children: [h('dt', { children: t('http_status') }), h('dd', { 'data-proxy-check-http': true, children: String(result.httpStatus) })] }),
        h('div', { children: [h('dt', { children: 'DNS' }), h('dd', { 'data-proxy-check-dns': true, children: result.remoteDns === true ? t('remote_dns') : '—' })] }),
        h('div', { children: [h('dt', { children: 'TLS' }), h('dd', { 'data-proxy-check-tls': true, children: t(result.tlsVerified === true ? 'tls_verified' : 'tls_plain') })] }),
        h('div', { children: [h('dt', { children: t('elapsed') }), h('dd', { 'data-proxy-check-elapsed': true, children: String(result.elapsedMs) + ' ms' })] }),
      ] }) : result?.state === 'fail' ? h('div', { class: 'pm-error pm-error--block', role: 'alert', 'data-proxy-check-failure': true, children: [badgeIcon('fail'), h('div', { children: [h('p', { children: m.diagnosticText(result.code, m.selectedProfile?.type) }), h('code', { dir: 'ltr', children: (PROXY_PHASES.includes(result.phase) ? result.phase + ' / ' : '') + result.code }), result.retryable === true ? h('p', { children: t('retry') }) : null] })] }) : h('p', { class: 'pm-muted', children: t('not_checked') }),
      h('p', { class: 'pm-note', 'data-proxy-tcp-note': true, children: t('tcp_fingerprint_detail') }),
    ] });
  }

  // ---- Companion -------------------------------------------------------------------------------------------------------------------
  // The companion is a separate Windows program that the person downloads from GitHub Releases; the extension never fetches or installs it.
  // This is a plain link that opens in a new tab without an opener or a referrer. The name of the link says it leaves for a new tab.
  const downloadLink = place => h('a', { class: 'button pm-companion-download', href: PROXY_COMPANION_DOWNLOAD_URL, target: '_blank', rel: 'noopener noreferrer', 'data-proxy-companion-download': place, children: [h('span', { children: t('companion_download') }), h('span', { class: 'proxy-workspace-sr', children: t('companion_new_tab') }), icon('external', 14)] });
  // The notice that some proxy types need that program. It is shown once the state has loaded and the companion is not known to be
  // available (nothing probes it on its own, so "not known" includes "not asked yet"), and it goes away when a check or a connection
  // finds it. It cannot be dismissed for good and it stores nothing: it is a function of the loaded state alone.
  function companionNotice(m) {
    const host = m.snapshot?.host;
    if (!host || host.available === true) return null;
    return h('div', { key: 'companion-notice', class: 'pm-banner pm-banner--warn pm-companion-notice', role: 'region', 'aria-label': t('companion_notice_title'), 'data-proxy-companion-notice': 'download', children: [
      icon('warning', 18),
      h('div', { class: 'pm-companion-notice-body', children: [h('p', { class: 'pm-companion-notice-title', children: t('companion_notice_title') }), h('p', { class: 'pm-banner-text', children: t('companion_notice') })] }),
      h('div', { class: 'pm-banner-actions', children: downloadLink('notice') }),
    ] });
  }
  function companionPanel(m) {
    const host = m.snapshot?.host, extensionId = m.extensionId;
    const installCommand = typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId) ? '.\\Install.ps1 -ChromeExtensionId ' + extensionId : typeof extensionId === 'string' && /^[a-zA-Z0-9_.@{}-]{1,128}$/.test(extensionId) ? ".\\Install.ps1 -FirefoxExtensionId '" + extensionId + "'" : '.\\Install.ps1';
    return h('div', { class: 'pm-panel pm-companion', id: 'pm-panel-companion', role: 'region', 'aria-label': t('companion'), 'data-proxy-panel-body': 'companion', children: [
      h('div', { class: 'pm-panel-head', children: h('span', { class: 'pm-state pm-state--' + (host?.available ? 'connected' : 'off'), 'data-proxy-companion-status': host ? host.available ? 'available' : 'missing' : 'unknown', children: [badgeIcon(host?.available ? 'pass' : 'unknown'), h('span', { children: host ? t(host.available ? 'companion_available' : 'companion_missing') : c('not_loaded') })] }) }),
      h('p', { class: 'pm-note', children: t('companion_detail') }),
      h('ol', { class: 'pm-install', children: [h('li', { children: [t('companion_install'), ' ', h('code', { children: 'Detect.Expert-Proxy-Companion-windows-x64.zip' })] }), h('li', { children: h('code', { dir: 'ltr', children: installCommand }) })] }),
      host?.available ? h('dl', { class: 'pm-hostfacts', children: [h('dt', { children: c('field_version') }), h('dd', { children: host.version ?? '—' }), h('dt', { children: c('field_type') }), h('dd', { children: PROXY_TYPES.filter(type => host.capabilities?.[type] === true).map(value => TYPE_LABELS[value]).join(', ') || '—' })] }) : null,
      h('div', { class: 'pm-panel-actions', children: [downloadLink('panel'), button(c('grant'), { disabled: m.busy, 'data-proxy-grant-native': true, onClick: () => m.grantNative() }), button(t('companion_check'), { disabled: m.busy, 'data-proxy-companion-check': true, onClick: () => m.checkCompanion() })] }),
    ] });
  }
  // The companion needs attention only after an explicit check found it missing or too old (nothing probes it on its own).
  function companionBanner(m) {
    const host = m.snapshot?.host;
    if (!host) return null;
    // Only said when it matters: a saved profile needs the companion, or the user asked.
    const needs = m.profiles.some(profile => profile.native), needsHttp = m.profiles.some(profile => profile.native && (profile.type === 'http' || profile.type === 'https'));
    if (!host.available) { if (!needs && !m.companionAsked) return null; return h('div', { class: 'pm-banner pm-banner--warn', role: 'status', 'data-proxy-companion-banner': 'missing', children: [icon('warning', 18), h('p', { class: 'pm-banner-text', children: t('companion_missing') }), h('div', { class: 'pm-banner-actions', children: [button(t('companion_steps'), { 'data-proxy-companion-steps': true, onClick: () => m.openPanel('companion') }), button(t('companion_check'), { disabled: m.busy, 'data-proxy-companion-check-banner': true, onClick: () => m.checkCompanion() })] })] }); }
    const missing = [host.capabilities?.http === true ? null : 'http', host.capabilities?.https === true ? null : 'https'].filter(Boolean);
    if (!missing.length || !needsHttp && !m.companionAsked) return null;
    return h('div', { class: 'pm-banner pm-banner--warn pm-banner--outdated', role: 'status', 'data-proxy-companion-outdated': missing.join(' '), children: [icon('warning', 18), h('p', { class: 'pm-banner-text', children: t('error_update_companion') }), h('div', { class: 'pm-banner-actions', children: [button(t('companion_steps'), { 'data-proxy-companion-steps': true, onClick: () => m.openPanel('companion') }), button(t('companion_check'), { disabled: m.busy, 'data-proxy-companion-check-banner': true, onClick: () => m.checkCompanion() })] })] });
  }

  // ---- Disclosures and messages ----------------------------------------------------------------------------------------------------------
  const SECTIONS = Object.freeze([['routing', 'route', 'routing'], ['analyzer', 'status', 'analyzer'], ['companion', 'companion', 'companion']]);
  function disclosures(m) {
    return h('div', { class: 'pm-disc-wrap', children: [
      h('div', { class: 'pm-disclosures', children: SECTIONS.map(([key, glyph, label]) => h('button', { type: 'button', class: 'pm-disc' + (m.openPanelId === key ? ' is-open' : ''), 'aria-expanded': m.openPanelId === key, 'aria-controls': 'pm-panel-' + key, 'data-proxy-panel': key, onClick: () => m.togglePanel(key), children: [icon(glyph, 16), h('span', { children: t(label) }), icon('caret', 14)] })) }),
      m.openPanelId === 'routing' ? routingPanel(m) : m.openPanelId === 'analyzer' ? analyzerPanel(m) : m.openPanelId === 'companion' ? companionPanel(m) : null,
    ] });
  }
  // The code of a failed action, or the action that fixes it (restart after the native grant); shown after the error text it follows.
  function diagnosticBlock(m) {
    const diagnostic = m.diagnostic;
    return diagnostic ? h('div', { key: 'diagnostic', class: 'pm-message pm-message--error', 'data-proxy-diagnostic': diagnostic.code, children: [badgeIcon('fail'), h('div', { class: 'pm-message-body', children: m.needsNativeRestart(diagnostic) ? [!m.error ? h('p', { children: t('native_restart') }) : null, button(t('native_restart_action'), { class: 'button button--primary', disabled: m.busy || m.configuration?.enabled !== false, 'data-proxy-restart-native': true, onClick: () => m.restartNative() })] : [!m.error ? h('p', { children: m.diagnosticText(diagnostic.code, m.selectedProfile?.type) }) : null, h('code', { dir: 'ltr', children: (PROXY_PHASES.includes(diagnostic.phase) ? diagnostic.phase + ' / ' : '') + diagnostic.code }), diagnostic.retryable === true ? h('p', { children: t('retry') }) : null] })] }) : null;
  }
  // Errors, the diagnostic of the connection, the login note and the notice, as the stack under the header card.
  function messages(m) {
    return [
      m.error ? h('p', { key: 'error', class: 'pm-message pm-message--error', role: 'alert', 'data-proxy-error': true, children: [badgeIcon('fail'), h('span', { children: m.error })] }) : null,
      diagnosticBlock(m),
      m.loginUnchecked ? h('div', { key: 'login', class: 'pm-message pm-message--info proxy-workspace-login-note', role: 'status', 'data-proxy-login-note': m.selectedProfile.type, children: [icon('info', 16), h('p', { class: 'pm-message-body', children: t('login_unchecked') }), button(t(m.checking ? 'checking' : 'check_connection'), { disabled: m.busy || m.checking, 'data-proxy-check-after-connect': true, onClick: () => { m.openPanel('analyzer'); return m.diagnoseConnection(); } }, 'proxy')] }) : null,
      m.notice ? h('p', { key: 'notice', class: 'pm-message pm-message--ok', role: 'status', 'data-proxy-notice': true, 'data-proxy-copied': typeof m.notice === 'object' ? m.notice.copied : undefined, children: [badgeIcon('pass'), h('span', { children: typeof m.notice === 'object' ? m.notice.text : m.notice })] }) : null,
      companionNotice(m),
      companionBanner(m),
    ].filter(Boolean);
  }
  return { summary, protections, saveBar, disclosures, messages, diagnosticBlock, stateChip };
}
