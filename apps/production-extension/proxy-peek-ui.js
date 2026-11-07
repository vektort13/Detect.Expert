// ADR-070/103/107 round 5: the details panel ("peek") of one profile: address, the latest manual check, what this kind of proxy can
// and cannot do, linked fingerprint profiles, and the saved check history as a compact timeline with a small latency sparkline.
// Presentation only. The history shows what the store holds (result, time, response time, DNS/TLS flags, HTTP status, exit IP); the
// exit IP is the proxy's own address as the check site saw it, and the country is the user's own tag.
import { proxyEndpointLabel } from './proxy-shared.js';
import { proxyHistoryOf, proxyHistoryRows, proxyHistoryIpChanged, PROXY_HISTORY_LIMITS } from './proxy-history.js';
import { proxyLatencyBucket, proxySparkline, proxyFormatRelative } from './proxy-ui-model.js';
import { regionName } from './fingerprint-region-names.js';
import { TYPE_LABELS, formatText } from './proxy-list-ui.js';
import { GEO_FLAGS } from './proxy-geo-shared.js';
import { proxyGeoLocation, proxyGeoNetwork, proxyGeoZone, proxyGeoAge, proxyGeoSourceName, proxyGeoKindKey, proxyGeoFlagKey, proxyGeoFlagTipKey, proxyGeoFlagState, proxyGeoErrorKey } from './proxy-geo-ui-model.js';

export function createProxyPeekUi({ h, t, c, icons, list }) {
  const { icon, badgeIcon, spinner } = icons, { button, iconButton } = list;

  function sparkline(m, entries) {
    const values = entries.filter(entry => entry.ok && entry.ms > 0).map(entry => entry.ms), data = proxySparkline(values);
    if (!data) return null;
    const label = t('latency') + ': ' + data.min + ' – ' + data.max + ' ms (' + t('history') + ': ' + data.count + ')';
    return h('div', { class: 'pm-spark', 'data-proxy-spark': String(data.count), children: [
      h('svg', { class: 'pm-spark-svg', role: 'img', 'aria-label': label, width: data.width, height: data.height, viewBox: '0 0 ' + data.width + ' ' + data.height, preserveAspectRatio: 'none', dir: 'ltr', children: [
        h('path', { class: 'pm-spark-area', d: data.area }), h('path', { class: 'pm-spark-line', d: data.line, fill: 'none' }),
        h('circle', { class: 'pm-spark-dot', cx: data.last.x, cy: data.last.y, r: 2.6 }),
      ] }),
      h('div', { class: 'pm-spark-scale', 'aria-hidden': 'true', dir: 'ltr', children: [h('span', { children: data.min + ' ms' }), h('span', { children: '≈ ' + data.median + ' ms' }), h('span', { children: data.max + ' ms' })] }),
    ] });
  }
  // DNS and TLS flags of one entry: a glyph, the letters, and a sentence for assistive technology.
  function flag(kind, state) {
    const words = kind === 'dns' ? { ok: t('remote_dns'), fail: t('error_dns') } : { ok: t('tls_verified'), fail: t('error_tls') };
    const description = state === 'unknown' ? (kind === 'dns' ? 'DNS' : 'TLS') + ': ' + t('history_unknown') : words[state];
    return h('span', { class: 'pm-micro pm-flag pm-flag--' + state, title: description, 'data-proxy-history-flag': kind, 'data-state': state, children: [badgeIcon(state === 'ok' ? 'pass' : state === 'fail' ? 'fail' : 'unknown'), h('span', { 'aria-hidden': 'true', children: kind === 'dns' ? 'DNS' : 'TLS' }), h('span', { class: 'proxy-workspace-sr', children: description })] });
  }
  function entryItem(m, row, index) {
    const bucket = row.ok ? proxyLatencyBucket(row.ms) : null;
    return h('li', { class: 'pm-tl-item pm-tl--' + (row.ok ? 'pass' : 'fail'), 'data-proxy-history-entry': index, 'data-state': row.ok ? 'pass' : 'fail', children: [
      h('span', { class: 'pm-tl-dot', 'aria-hidden': 'true', children: badgeIcon(row.ok ? 'pass' : 'fail') }),
      h('div', { class: 'pm-tl-main', children: [
        h('div', { class: 'pm-tl-line', children: [
          h('time', { class: 'pm-tl-time', dateTime: new Date(row.lastAt).toISOString(), title: m.stamp(row.lastAt), 'data-proxy-history-time': index, children: proxyFormatRelative(row.lastAt, m.now, m.langTag) }),
          h('span', { class: 'pm-pill pm-check pm-check--' + (row.ok ? 'pass' : 'fail') + (bucket ? ' pm-latency--' + bucket : ''), 'data-proxy-history-result': index, children: [badgeIcon(row.ok ? 'pass' : 'fail'), h('span', { children: row.ok ? t('check_pass') : t('check_fail') }), row.ok ? null : ' ', row.ok ? null : h('code', { children: row.code })] }),
          h('span', { class: 'pm-num', dir: 'ltr', 'data-proxy-history-ms': index, children: row.ok ? String(row.ms) + ' ms' : '—' }),
        ] }),
        // A failed check has no address, flags or status; flags that were not determined are left out, like in the list.
        row.ok ? h('div', { class: 'pm-tl-line pm-tl-line--meta', children: [
          h('span', { class: 'pm-mono', dir: 'ltr', 'data-proxy-history-ip': index, children: row.ip || '—' }),
          row.ipChanged ? h('span', { class: 'pm-pill pm-changed', title: t('ip_changed_detail'), 'data-proxy-ip-changed': index, children: [badgeIcon('pending'), h('span', { children: t('ip_changed') })] }) : null,
          row.dns !== 'unknown' ? flag('dns', row.dns) : null, row.tls !== 'unknown' ? flag('tls', row.tls) : null,
          h('span', { class: 'pm-tl-status', 'data-proxy-history-status': index, children: row.status ? 'HTTP ' + row.status : '—' }),
        ] }) : null,
        row.checks > 1 ? h('small', { class: 'pm-tl-stay', 'data-proxy-history-stay': index, 'data-checks': row.checks, children: formatText(t('history_stay'), { time: m.stamp(row.firstAt), count: row.checks }) }) : null,
      ] }),
    ] });
  }
  function historySection(m, profile) {
    if (!m.history) return null;
    const entries = proxyHistoryOf(m.history, profile.id), rows = proxyHistoryRows(entries, PROXY_HISTORY_LIMITS.shown), confirming = m.historyConfirm === profile.id;
    return h('section', { class: 'pm-section pm-history', id: 'proxy-history-' + profile.id, 'aria-labelledby': 'proxy-history-title-' + profile.id, 'data-proxy-history': profile.id, children: [
      h('div', { class: 'pm-section-head', children: [
        h('h4', { id: 'proxy-history-title-' + profile.id, class: 'pm-section-title', children: [icon('history', 16), t('history_title')] }),
        proxyHistoryIpChanged(entries) ? h('span', { class: 'pm-pill pm-changed', title: t('ip_changed_detail'), 'data-proxy-ip-changed-summary': profile.id, children: [badgeIcon('pending'), h('span', { children: t('ip_changed') })] }) : null,
      ] }),
      sparkline(m, entries),
      confirming ? h('div', { class: 'pm-confirm', role: 'group', 'aria-label': t('history_clear_confirm'), 'data-proxy-history-confirm': profile.id, children: [h('p', { children: t('history_clear_confirm') }), h('div', { class: 'pm-confirm-actions', children: [button(c('cancel'), { 'data-proxy-history-keep': true, onClick: () => m.setHistoryConfirm(null) }), button(c('action_remove'), { class: 'button pm-danger', 'data-proxy-history-clear-confirm': profile.id, onClick: () => m.clearHistory(profile.id) }, 'delete')] })] }) : null,
      rows.length ? h('ol', { class: 'pm-timeline', 'data-proxy-history-table': profile.id, 'aria-label': t('history_title') + ': ' + profile.name, children: rows.map((row, index) => entryItem(m, row, index)) }) : h('p', { class: 'pm-muted', 'data-proxy-history-empty': profile.id, children: t('history_empty') }),
      entries.length && !confirming ? h('div', { class: 'pm-section-foot', children: button(t('history_clear'), { class: 'button button--text', 'aria-label': t('history_clear') + ': ' + profile.name, 'data-proxy-history-clear': profile.id, onClick: () => m.setHistoryConfirm(profile.id) }, 'delete') }) : null,
    ] });
  }
  const fact = (label, value, properties = {}) => h('div', { class: 'pm-fact', ...properties, children: [h('dt', { children: label }), h('dd', { children: value })] });

  // ---- Geolocation details (ADR-109) -------------------------------------------------------------------------------------------------------
  // What the provider reported for the exit IP of the latest passing manual check, with its source and age, or the plain reason there is
  // nothing to show. Shown only while the feature is on. Provider text is a text node only (inside <bdi> where its direction can differ).
  const bdi = text => h('bdi', { children: text });
  const dash = h('span', { 'aria-hidden': 'true', children: '—' });
  function geoSection(m, profile, checked) {
    const geo = m.geo;
    if (!geo?.on) return null;
    const g = geo.t, id = profile.id, info = geo.row(profile, checked), record = info.record, data = info.phase === 'data', titleId = 'proxy-geo-title-' + id;
    const age = record ? proxyGeoAge(record, m.now, m.langTag) : '';
    const reason = info.phase === 'no-ip' ? g('detail_reason_no_ip') : info.phase === 'private' ? g('detail_reason_private') : info.phase === 'nodata' ? g('detail_reason_nodata')
      : info.phase === 'error' ? g('detail_reason_error', { reason: g(proxyGeoErrorKey(info.error)) }) : info.pending ? g('detail_reason_pending') : !info.canLookup ? g('detail_reason_not_ready') : g('detail_reason_empty');
    const lookup = info.canLookup || info.pending ? button(info.pending ? g('cell_pending') : data || info.phase === 'nodata' ? g('detail_refresh') : g('detail_lookup'), { class: 'button' + (info.pending ? ' is-busy' : ''), 'aria-disabled': info.pending ? 'true' : undefined, 'data-proxy-geo-lookup': id, onClick: () => { if (!info.pending) geo.lookup(id); } }, info.pending ? null : 'search') : null;
    const body = [];
    if (data) {
      const loc = proxyGeoLocation(record, info.tag), net = proxyGeoNetwork(record), zone = record.timezone ? proxyGeoZone(record.timezone, m.now, m.langTag) : null, quota = geo.quota(record.provider);
      const zoneName = record.timezone ? h('span', { class: 'pm-mono', dir: 'ltr', children: record.timezone }) : dash;
      body.push(
        h('p', { class: 'pm-geo-source', 'data-proxy-geo-source': record.provider, children: [h('strong', { children: proxyGeoSourceName(record) }), ' · ', h('time', { dateTime: new Date(record.at).toISOString(), title: m.stamp(record.at), children: g('detail_updated', { age }) })] }),
        info.stale ? h('p', { class: 'pm-geo-stale', 'data-proxy-geo-stale': id, children: [h('span', { class: 'pm-pill pm-changed', children: [badgeIcon('pending'), h('span', { children: g('cell_stale_title', { age }) })] })] }) : null,
        h('dl', { class: 'pm-facts pm-geo-facts', children: [
          fact(g('detail_country'), loc.country || loc.countryName ? h('span', { class: 'pm-inline', children: [loc.country ? h('span', { class: 'pm-pill pm-country', children: h('bdi', { dir: 'ltr', class: 'pm-country-code', children: loc.country }) }) : null, loc.countryName ? bdi(loc.countryName) : null] }) : dash),
          fact(g('detail_region'), loc.region ? bdi(loc.region) : dash),
          fact(g('detail_city'), loc.city ? bdi(loc.city) : dash),
          fact(g('detail_zone'), zone ? h('span', { class: 'pm-inline', children: [zoneName, h('span', { class: 'pm-num', dir: 'ltr', children: zone.offset })] }) : zoneName),
          fact(g('detail_local_time'), zone ? h('span', { class: 'pm-num', dir: 'ltr', children: zone.time }) : dash),
          fact(g('detail_asn'), net.asn ? h('span', { class: 'pm-mono', dir: 'ltr', children: net.asn }) : dash),
          fact(g('detail_org'), net.org ? bdi(net.org) : dash),
          fact(g('detail_isp'), net.isp ? bdi(net.isp) : dash),
          fact(g('detail_kind'), record.kind ? h('span', { class: 'pm-pill pm-geo-kind', children: g(proxyGeoKindKey(record.kind)) }) : dash),
          fact(g('detail_flags'), h('ul', { class: 'pm-geo-flaglist', 'data-proxy-geo-flags': 'list', children: GEO_FLAGS.map(flag => { const state = proxyGeoFlagState(record, flag); return h('li', { key: flag, 'data-proxy-geo-flag-state': flag, 'data-state': state, title: g(proxyGeoFlagTipKey(flag, record.provider)), children: [h('span', { children: g(proxyGeoFlagKey(flag)) }), ': ', h('strong', { children: g(state === 'yes' ? 'flag_yes' : state === 'no' ? 'flag_no' : 'flag_unreported') })] }); }) })),
        ] }),
        loc.mismatch ? h('p', { class: 'pm-note pm-note--warn pm-geo-mismatch-note', 'data-proxy-geo-mismatch': id, children: [badgeIcon('warning'), ' ', g('cell_mismatch', { country: loc.country, tag: loc.tag.toUpperCase() })] }) : null,
        record.provider === 'ipapi' && record.flags.proxy === true ? h('p', { class: 'pm-muted', children: g('flag_proxy_ipapi_tip') }) : null,
        typeof quota === 'number' ? h('p', { class: 'pm-muted', 'data-proxy-geo-quota': String(quota), children: g('detail_quota', { n: quota }) }) : null,
      );
      if (info.error) body.push(h('p', { class: 'pm-muted', 'data-proxy-geo-reason': 'error', children: g('detail_reason_error', { reason: g(proxyGeoErrorKey(info.error)) }) }));
    } else body.push(h('p', { class: 'pm-muted', 'data-proxy-geo-reason': info.phase === 'empty' && info.pending ? 'pending' : info.phase, children: reason }));
    return h('section', { class: 'pm-section pm-geo-detail', 'aria-labelledby': titleId, 'aria-busy': info.pending ? 'true' : undefined, 'data-proxy-geo-detail': id, 'data-state': info.phase, children: [
      h('div', { class: 'pm-section-head', children: h('h4', { id: titleId, class: 'pm-section-title', children: [icon('globe', 16), g('detail_title')] }) }),
      ...body,
      h('p', { class: 'pm-note', children: g('detail_caveat') }),
      lookup ? h('div', { class: 'pm-section-foot', children: lookup }) : null,
    ] });
  }

  function peek(m, profile) {
    const id = profile.id, cfg = m.configuration, active = cfg.enabled && cfg.selectedId === id, activity = active ? m.state : 'off';
    const checked = Object.hasOwn(m.checks, id) ? m.checks[id] : null, diagnostic = checked?.diagnostic, running = m.checkingProfiles?.id === id && !m.checkingProfiles.stopping;
    const address = proxyEndpointLabel(profile.host, profile.port), name = regionName(m.locale, profile.country ?? ''), ids = m.linkedOf(id);
    const detailKey = profile.type === 'socks5' ? 'socks_detail' : profile.type + '_detail';
    const bucket = diagnostic?.state === 'pass' ? proxyLatencyBucket(diagnostic.elapsedMs) : null;
    return h('aside', { class: 'pm-peek', role: 'region', 'aria-labelledby': 'pm-peek-title', 'data-proxy-peek': id, ref: m.peekRef, tabIndex: -1, onKeyDown: m.onPeekKey, children: [
      h('header', { class: 'pm-peek-head', children: [
        h('span', { class: 'pm-avatar pm-avatar--lg pm-type--' + profile.type, 'aria-hidden': 'true', children: icon(profile.type, 22) }),
        h('div', { class: 'pm-peek-titles', children: [
          h('h3', { id: 'pm-peek-title', class: 'pm-peek-title', dir: 'auto', children: profile.name }),
          h('div', { class: 'pm-peek-chips', children: [list.typePill(profile.type), list.countryChip(m, profile), active ? h('span', { class: 'pm-route-tag pm-route-tag--' + activity, children: [badgeIcon(activity === 'connected' ? 'pass' : 'pending'), t('state_' + activity.replaceAll('-', '_'))] }) : null] }),
        ] }),
        iconButton(t('close'), { 'data-proxy-peek-close': true, onClick: () => m.closePeek() }, 'close'),
      ] }),
      h('div', { class: 'pm-peek-body', children: [
        h('div', { class: 'pm-peek-actions', children: [
          button(t('check_connection'), { class: 'button button--primary', disabled: m.busy, 'data-proxy-peek-check': id, onClick: () => m.checkOne(id) }, 'check'),
          active ? button(t('disconnect'), { disabled: m.busy, 'data-proxy-peek-disconnect': id, onClick: () => m.disconnect() }, 'disconnect') : button(t('connect'), { disabled: m.busy || m.state === 'connecting', 'data-proxy-peek-connect': id, onClick: () => m.connect(profile) }, 'connect'),
        ] }),
        h('dl', { class: 'pm-facts', children: [
          fact(t('column_address'), address ? h('button', { type: 'button', class: 'pm-address pm-address--plain', dir: 'ltr', title: t('copy_address') + ': ' + address, 'aria-label': t('copy_address') + ': ' + address, 'data-proxy-peek-copy-address': id, onClick: () => m.copyAddress(profile), children: [h('span', { class: 'pm-address-text', children: address }), icon('copy', 13)] }) : '—'),
          fact(t('country_short'), profile.country ? profile.country + (name ? ' · ' + name : '') : t('country_none'), { title: profile.country ? t('country_title') : undefined }),
          fact(t('last_check'), running ? h('span', { class: 'pm-pill pm-check pm-check--checking', children: [spinner(14), h('span', { children: t('checking') })] }) : diagnostic ? h('span', { class: 'pm-inline', children: [
            h('span', { class: 'pm-pill pm-check pm-check--' + diagnostic.state + (bucket ? ' pm-latency--' + bucket : ''), children: [badgeIcon(diagnostic.state === 'pass' ? 'pass' : 'fail'), h('span', { children: diagnostic.state === 'pass' ? (bucket ? t('latency_' + bucket) : t('check_pass')) : t('check_fail') }), diagnostic.state === 'pass' ? ' ' : null, diagnostic.state === 'pass' ? h('span', { class: 'pm-num', dir: 'ltr', children: diagnostic.elapsedMs + ' ms' }) : null] }),
            checked?.checkedAt ? h('time', { class: 'pm-time', dateTime: new Date(checked.checkedAt).toISOString(), title: m.stamp(checked.checkedAt), children: proxyFormatRelative(checked.checkedAt, m.now, m.langTag) }) : null,
          ] }) : t('no_check')),
          diagnostic?.state === 'pass' ? fact(t('remote_ip'), h('span', { class: 'pm-mono', dir: 'ltr', children: diagnostic.ip ?? '—' })) : null,
          diagnostic?.state === 'pass' ? fact(t('http_status'), String(diagnostic.httpStatus)) : null,
          diagnostic?.state === 'pass' ? fact('DNS · TLS', h('span', { class: 'pm-inline', children: [diagnostic.remoteDns === true ? list.microChip('dns', t('remote_dns')) : h('span', { children: '—' }), diagnostic.tlsVerified === true ? list.microChip('tls', t('tls_verified')) : h('span', { children: t('tls_plain') })] })) : null,
          diagnostic?.state === 'fail' ? fact(t('check_fail'), h('span', { class: 'pm-fail-note pm-fail-note--full', children: [h('span', { children: m.diagnosticText(diagnostic.code, profile.type) }), ' ', h('code', { dir: 'ltr', children: diagnostic.code })] })) : null,
        ] }),
        geoSection(m, profile, checked),
        h('section', { class: 'pm-section pm-honest', 'aria-label': TYPE_LABELS[profile.type], children: [
          h('p', { class: 'pm-note', 'data-proxy-type-detail': profile.type, children: t(detailKey) }),
          h('details', { class: 'pm-limits', 'data-proxy-limits': true, children: [h('summary', { children: [icon('info', 15), h('span', { children: t('facts_limits') })] }),
            profile.type === 'http' || profile.type === 'https' ? h('p', { class: 'pm-note', 'data-proxy-relay-detail': true, children: t('http_relay_detail') }) : null,
            h('p', { class: 'pm-note', 'data-proxy-tcp-note-peek': true, children: t('tcp_fingerprint_detail') }),
          ] }),
        ] }),
        m.linkedAvailable ? h('section', { class: 'pm-section pm-linked-section', 'data-proxy-linked-section': id, children: [
          h('h4', { class: 'pm-section-title', children: [icon('link', 16), t('column_linked')] }),
          ids.length ? h('p', { class: 'pm-linked-line', children: [h('span', { class: 'pm-pill pm-pill--info', 'data-proxy-peek-linked': String(ids.length), children: [icon('link', 13), h('span', { class: 'pm-num', children: String(ids.length) })] })] }) : h('p', { class: 'pm-muted', children: t('linked_none') }),
        ] }) : null,
        historySection(m, profile),
        h('div', { class: 'pm-peek-foot', children: [
          button(c('action_edit'), { class: 'button button--text', disabled: m.busy, 'data-proxy-peek-edit': id, onClick: () => m.edit(profile) }, 'edit'),
          button(t('duplicate'), { class: 'button button--text', disabled: m.busy, 'data-proxy-peek-duplicate': id, onClick: () => m.duplicate(profile) }, 'plus'),
          button(t('copy_json'), { class: 'button button--text pm-danger-text', disabled: m.busy, 'data-proxy-peek-copy': id, onClick: () => m.copyJson(id) }, 'copy'),
          button(c('action_remove'), { class: 'button button--text pm-danger-text', disabled: m.busy || active, 'data-proxy-peek-remove': id, onClick: () => m.askRemove([id]) }, 'delete'),
        ] }),
      ] }),
    ] });
  }
  return { peek, sparkline };
}
