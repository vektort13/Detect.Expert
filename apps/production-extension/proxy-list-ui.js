// ADR-070/103/107 round 5: the profile list of the Proxy manager. A real ARIA grid (rows, column headers as sort buttons, one roving
// tab stop), filter chips with counts, the list header, the sticky action bar for selection, bulk checks and deletion, and the empty,
// loading and error states. Presentation only: every value comes from the view model `m` built by proxy-ui.js and every action is a
// handler of it. Nothing here reads a credential: rows show saved metadata and manual check results.
import { proxyEndpointLabel, PROXY_TYPES } from './proxy-shared.js';
import { proxyLatencyBucket, proxyFormatRelative, PROXY_STATUS_FILTERS, PROXY_VIEW_SORTS } from './proxy-ui-model.js';
import { regionName } from './fingerprint-region-names.js';
import { GEO_COLUMNS, GEO_FLAGS } from './proxy-geo-shared.js';
import { proxyGeoLocation, proxyGeoNetwork, proxyGeoFlags, proxyGeoZone, proxyGeoAge, proxyGeoSourceName, proxyGeoKindKey, proxyGeoFlagKey, proxyGeoFlagTipKey, proxyGeoErrorKey } from './proxy-geo-ui-model.js';

export const TYPE_LABELS = Object.freeze({ socks5: 'SOCKS5', http: 'HTTP', https: 'HTTPS', vless: 'VLESS', openvpn: 'OpenVPN' });
export const COLUMN_ORDER = Object.freeze(['select', 'name', 'type', 'address', 'country', 'linked', 'check', 'ip', 'checked', 'actions']);
// ADR-109: the geolocation columns sit between the exit IP and the check time. COLUMN_ORDER (and with it the stored view) is unchanged.
const META_ORDER = Object.freeze([...COLUMN_ORDER.slice(0, COLUMN_ORDER.indexOf('checked')), ...GEO_COLUMNS, ...COLUMN_ORDER.slice(COLUMN_ORDER.indexOf('checked'))]);
const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll('{' + key + '}', String(value)), text);
export const formatText = fill;

export function createProxyListUi({ h, t, c, icons }) {
  const { icon, badgeIcon, spinner, illustration } = icons;
  const button = (label, properties = {}, glyph = null, size = 16) => h('button', { type: 'button', class: 'button', ...properties, children: [glyph ? icon(glyph, size) : null, label === null ? null : h('span', { children: label })] });
  const iconButton = (label, properties, glyph) => h('button', { type: 'button', ...properties, class: 'pm-iconbtn' + (properties.class ? ' ' + properties.class : ''), 'aria-label': label, title: label, children: icon(glyph, 17) });

  // ---- Pieces ----------------------------------------------------------------------------------------------------------------------
  const typePill = type => h('span', { class: 'pm-pill pm-typepill pm-type--' + type, 'data-proxy-type-pill': type, children: [icon(type, 15), h('span', { children: TYPE_LABELS[type] })] });
  const avatar = type => h('span', { class: 'pm-avatar pm-type--' + type, 'aria-hidden': 'true', children: icon(type, 18) });
  function countryChip(m, profile) {
    if (!profile.country) return null;
    const name = regionName(m.locale, profile.country);
    return h('span', { class: 'pm-pill pm-country', title: t('country_title'), 'data-proxy-country': profile.country, children: [h('bdi', { dir: 'ltr', class: 'pm-country-code', children: profile.country }), name ? ' ' : null, name ? h('bdi', { class: 'pm-country-name', children: name }) : null] });
  }
  // DNS and TLS micro chips of a result: a glyph, the letters and a sentence for assistive technology.
  function microChip(kind, description) {
    return h('span', { class: 'pm-micro', title: description, 'data-proxy-badge': kind, children: [badgeIcon('pass'), h('span', { 'aria-hidden': 'true', children: kind === 'dns' ? 'DNS' : 'TLS' }), h('span', { class: 'proxy-workspace-sr', children: description })] });
  }
  const checkWord = bucket => t('latency_' + bucket);
  // The result pill reserves its width: the state never changes the cell's size, so results arriving shift nothing.
  function checkCell(m, profile, info) {
    const { diagnostic } = info, state = info.running ? 'checking' : diagnostic?.state === 'pass' || diagnostic?.state === 'fail' ? diagnostic.state : 'unknown';
    const bucket = state === 'pass' ? proxyLatencyBucket(diagnostic.elapsedMs) : null;
    const pill = state === 'checking' ? h('span', { class: 'pm-pill pm-check pm-check--checking', children: [spinner(14), h('span', { children: t('checking') })] })
      : state === 'pass' ? h('span', { class: 'pm-pill pm-check pm-check--pass pm-latency--' + (bucket ?? 'ok'), children: [badgeIcon('pass'), h('span', { children: bucket ? checkWord(bucket) : t('check_pass') }), ' ', h('span', { class: 'pm-num', dir: 'ltr', 'data-proxy-profile-latency': profile.id, children: String(diagnostic.elapsedMs) + ' ms' })] })
      : state === 'fail' ? h('span', { class: 'pm-pill pm-check pm-check--fail', children: [badgeIcon('fail'), h('span', { children: t('check_fail') })] })
      : h('span', { class: 'pm-pill pm-check pm-check--unknown', children: [badgeIcon('unknown'), h('span', { children: t('no_check') })] });
    return h('div', { class: 'pm-health', 'data-proxy-health': profile.id, 'data-state': state, children: [
      pill,
      state === 'pass' && diagnostic.remoteDns === true ? microChip('dns', t('remote_dns')) : null,
      state === 'pass' && diagnostic.tlsVerified === true ? microChip('tls', t('tls_verified')) : null,
      state === 'fail' ? h('span', { class: 'pm-fail-note', 'data-proxy-profile-error': profile.id, title: m.diagnosticText(diagnostic.code, profile.type), children: [h('span', { class: 'pm-fail-text', children: m.diagnosticText(diagnostic.code, profile.type) }), ' ', h('code', { dir: 'ltr', children: diagnostic.code })] }) : null,
      state === 'pass' ? h('span', { class: 'proxy-workspace-sr', 'data-proxy-health-meta': profile.id, children: 'HTTP ' + diagnostic.httpStatus }) : null,
    ] });
  }
  function linkedCell(m, profile) {
    const ids = m.linkedOf(profile.id);
    return h('span', { class: 'pm-linked' + (ids.length ? '' : ' is-none'), 'data-proxy-linked': profile.id, 'data-count': String(ids.length), title: t('column_linked') + ': ' + ids.length, children: ids.length ? [icon('link', 14), h('span', { class: 'pm-num', children: String(ids.length) })] : h('span', { 'aria-hidden': 'true', children: '—' }) });
  }
  const relative = (m, at) => at ? h('time', { class: 'pm-time', dateTime: new Date(at).toISOString(), title: m.stamp(at), 'data-proxy-checked': '1', children: proxyFormatRelative(at, m.now, m.langTag) }) : h('span', { 'aria-hidden': 'true', children: '—' });

  // ---- Menus -----------------------------------------------------------------------------------------------------------------------
  // A menu button and its popup. Items: { id, label, glyph, run, danger, disabled, checked, role, attrs }.
  function menu(m, { id, label, glyph, items, align = 'end', caret = false, text = null, triggerProps = {}, class: extra = '' }) {
    const open = m.menu === id, listId = 'pm-menu-' + id.replace(/[^a-zA-Z0-9_-]/g, '-');
    return h('div', { class: 'pm-menu-wrap pm-menu--' + align + (open ? ' is-open' : '') + (extra ? ' ' + extra : ''), 'data-menu-open': open ? 'true' : undefined, children: [
      h('button', { type: 'button', class: text ? 'button' : 'pm-iconbtn', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? listId : undefined, 'aria-label': text ? undefined : label, title: text ? undefined : label, 'data-proxy-menu': id, disabled: m.busy && !triggerProps.allowBusy, ...triggerProps, onClick: () => m.toggleMenu(id), children: [icon(glyph, 17), text ? h('span', { children: text }) : null, caret ? icon('caret', 14) : null] }),
      open ? h('div', { class: 'pm-menu', id: listId, role: 'menu', 'aria-label': label, onKeyDown: m.onMenuKey, children: items.filter(Boolean).map(item => item.group
        ? h('div', { key: item.id, class: 'pm-menugroup', role: 'group', 'aria-label': item.label, children: [h('div', { class: 'pm-menuhead', 'aria-hidden': 'true', children: item.label }), ...item.items.filter(Boolean).map(entry => menuItem(m, entry))] })
        : menuItem(m, item)) }) : null,
    ] });
  }
  // One menu entry. `note` is a second line under the label (the reason an entry is unavailable); `title` is its tooltip.
  function menuItem(m, item) {
    return h('button', { type: 'button', key: item.id, role: item.role ?? 'menuitem', tabIndex: -1, class: 'pm-menuitem' + (item.danger ? ' is-danger' : '') + (item.checked ? ' is-checked' : '') + (item.note ? ' has-note' : ''), 'aria-checked': item.role === 'menuitemcheckbox' || item.role === 'menuitemradio' ? Boolean(item.checked) : undefined, disabled: item.disabled === true, title: item.title, ...(item.attrs ?? {}), onClick: () => { m.closeMenu(); item.run?.(); }, children: [icon(item.glyph ?? 'unknown', 16), h('span', { class: 'pm-menuitem-label', children: item.note ? [h('span', { class: 'pm-menuitem-text', children: item.label }), h('small', { class: 'pm-menuitem-note', children: item.note })] : item.label }), item.role && item.checked ? icon('pass', 14) : null] });
  }

  // ---- Rows ------------------------------------------------------------------------------------------------------------------------
  // The optional columns in their fixed order; the wrapper keeps them together (a card line on narrow lists) and adds no semantics.
  const metaColumns = m => [...m.view.columns.filter(column => COLUMN_ORDER.includes(column) && !['select', 'name', 'actions'].includes(column)), ...(m.geo?.columns ?? [])].sort((a, b) => META_ORDER.indexOf(a) - META_ORDER.indexOf(b));
  // ---- Geolocation cells (ADR-109) ---------------------------------------------------------------------------------------------------
  // The five columns describe the exit IP of the latest passing manual check, as the provider reported it. Provider text is only ever a
  // text node (inside <bdi> where its direction can differ), never an attribute or markup. Every cell carries its phase in
  // data-proxy-geo-state; the first shown geo column also carries the busy marker, the error and the lookup button, so they are not repeated.
  const CARD_LABELS = new Set(['geonet', 'geoflags', 'geotime']);
  const dash = (title, readable = false) => [h('span', { class: 'pm-geo-dash', 'aria-hidden': 'true', title: title || undefined, children: '—' }), readable && title ? h('span', { class: 'proxy-workspace-sr', children: title }) : null];
  const bdi = text => h('bdi', { children: text });
  function geoLookupButton(m, profile, info, tab) {
    const g = m.geo.t, retry = info.phase === 'error', busy = info.pending;
    return h('button', { type: 'button', class: 'pm-geo-btn' + (busy ? ' is-busy' : ''), tabIndex: tab, 'aria-disabled': busy ? 'true' : undefined, 'aria-label': busy ? undefined : g(retry ? 'cell_retry_for' : 'cell_lookup_for', { name: profile.name }), 'data-proxy-geo-lookup': profile.id,
      onClick: () => { if (!busy) m.geo.lookup(profile.id); },
      children: [busy ? spinner(12) : icon(retry ? 'history' : 'search', 13), h('span', { children: busy ? g('cell_pending') : retry ? g('cell_retry') : g('cell_lookup') })] });
  }
  // What only the first shown geo column adds while there is no record to show: the reason, the error with its retry, or the lookup.
  function geoLead(m, profile, info, tab) {
    const g = m.geo.t;
    if (info.phase === 'no-ip') return { node: dash(g('cell_check_first'), true), empty: true };
    if (info.phase === 'private') return { node: dash(g('cell_not_public'), true), empty: true };
    if (info.phase === 'nodata') return { node: dash(g('cell_nodata'), true), empty: true };
    if (info.phase === 'error') return { node: h('div', { class: 'pm-geo-stack', children: [h('span', { class: 'pm-pill pm-geo-error', 'data-proxy-geo-error': profile.id, 'data-code': info.error, children: [badgeIcon('fail'), h('span', { children: g(proxyGeoErrorKey(info.error)) })] }), info.canLookup ? geoLookupButton(m, profile, info, tab) : null] }), empty: false };
    if (info.canLookup || info.pending) return { node: geoLookupButton(m, profile, info, tab), empty: false };
    return { node: dash(g('cell_not_ready'), true), empty: true };
  }
  const geoStack = (primary, secondary) => h('div', { class: 'pm-geo-stack', children: [h('div', { class: 'pm-geo-primary', children: primary }), secondary ? h('div', { class: 'pm-geo-secondary', children: secondary }) : null] });
  // The body of one column for a stored record: { node, empty } where empty means the provider reported nothing for this column.
  function geoBody(m, profile, col, info) {
    const g = m.geo.t, record = info.record;
    if (col === 'geo') {
      const loc = proxyGeoLocation(record, info.tag);
      if (!loc.hasPlace && loc.countryName === '' && loc.country === '') return { node: dash(g('cell_unreported'), true), empty: true };
      const place = loc.hasPlace ? [loc.city ? bdi(loc.city) : null, loc.city && loc.region ? ', ' : null, loc.region ? bdi(loc.region) : null] : bdi(loc.countryName || loc.country);
      const chip = loc.country ? h('span', { class: 'pm-pill pm-country pm-geo-country', 'data-proxy-geo-country': loc.country, children: [h('bdi', { dir: 'ltr', class: 'pm-country-code', children: loc.country }), loc.hasPlace && loc.countryName ? ' ' : null, loc.hasPlace && loc.countryName ? h('bdi', { class: 'pm-geo-country-name', children: loc.countryName }) : null] }) : null;
      const mark = loc.mismatch ? h('span', { class: 'pm-geo-mismatch', 'data-proxy-geo-mismatch': profile.id, title: g('cell_mismatch', { country: loc.country, tag: loc.tag.toUpperCase() }), children: [badgeIcon('warning'), h('span', { class: 'proxy-workspace-sr', children: g('cell_mismatch_sr') })] }) : null;
      return { node: geoStack(place, chip || mark ? [chip, mark] : null), empty: false };
    }
    if (col === 'geonet') {
      const net = proxyGeoNetwork(record);
      if (net.empty) return { node: dash(g('cell_unreported'), true), empty: true };
      return { node: geoStack([net.asn ? h('span', { class: 'pm-mono pm-geo-asn', dir: 'ltr', children: net.asn }) : null, net.asn && net.name ? ' ' : null, net.name ? bdi(net.name) : null], net.showIsp ? bdi(net.isp) : null), empty: false };
    }
    if (col === 'geokind') {
      if (record.kind === '') return { node: dash(g('kind_unknown'), true), empty: true };
      return { node: h('span', { class: 'pm-pill pm-geo-kind', 'data-proxy-geo-kind': record.kind, children: g(proxyGeoKindKey(record.kind)) }), empty: false };
    }
    if (col === 'geoflags') {
      const flags = proxyGeoFlags(record);
      if (flags.state === 'unreported') return { node: dash(g('cell_flags_unreported_title'), true), empty: true };
      if (flags.state === 'clear') return { node: h('span', { class: 'pm-geo-flags-none', title: g('cell_flags_none_title'), 'data-proxy-geo-flags': 'none', children: g('cell_flags_none') }), empty: false };
      return { node: h('span', { class: 'pm-geo-flags', 'data-proxy-geo-flags': 'chips', children: flags.active.map(flag => h('span', { key: flag, class: 'pm-flagchip', title: g(proxyGeoFlagTipKey(flag, record.provider)), 'data-proxy-geo-flag': flag, children: g(proxyGeoFlagKey(flag)) })) }), empty: false };
    }
    if (record.timezone === '') return { node: dash(g('cell_unreported'), true), empty: true };
    const zone = proxyGeoZone(record.timezone, m.now, m.langTag), name = h('span', { class: 'pm-mono', dir: 'ltr', children: record.timezone });
    return { node: zone ? geoStack([h('span', { class: 'pm-num pm-geo-clock', dir: 'ltr', children: zone.time }), ' ', h('span', { class: 'pm-num pm-geo-offset', dir: 'ltr', children: zone.offset })], name) : geoStack(name, null), empty: false };
  }
  // The cells of one row, by column. The first shown column leads (see geoLead); a stored record is shown even while it is refreshed.
  function geoCells(m, profile, check, tab) {
    const g = m.geo.t, info = m.geo.row(profile, check), cells = {}, data = info.phase === 'data';
    const lead = data ? null : geoLead(m, profile, info, tab);
    const title = data ? (info.stale ? g('cell_stale_title', { age: proxyGeoAge(info.record, m.now, m.langTag) }) : g('cell_source_title', { provider: proxyGeoSourceName(info.record), age: proxyGeoAge(info.record, m.now, m.langTag) })) : undefined;
    m.geo.columns.forEach((col, position) => {
      const first = position === 0;
      const part = data ? geoBody(m, profile, col, info) : first ? lead : { node: dash(info.phase === 'error' ? g(proxyGeoErrorKey(info.error)) : ''), empty: true };
      const busy = data && first && info.pending ? h('span', { class: 'pm-geo-busy', children: [spinner(12), h('span', { class: 'proxy-workspace-sr', children: g('cell_pending') })] }) : null;
      cells[col] = h('div', { role: 'gridcell', class: 'pm-cell pm-cell--' + col + (part.empty ? ' is-empty' : '') + (data && info.stale ? ' is-stale' : ''), 'data-col': col, 'data-proxy-geo-state': info.phase, 'data-label': CARD_LABELS.has(col) ? g('col_' + col) : undefined, 'aria-busy': info.pending ? 'true' : undefined, title, children: [part.node, busy] });
    });
    return cells;
  }

  function row(m, profile, index) {
    const id = profile.id, name = profile.name, cfg = m.configuration;
    const active = cfg.enabled && cfg.selectedId === id, chosen = cfg.selectedId === id, activity = active ? m.state : 'off';
    const checked = Object.hasOwn(m.checks, id) ? m.checks[id] : null, diagnostic = checked?.diagnostic;
    const running = m.checkingProfiles?.id === id && !m.checkingProfiles.stopping;
    const info = { diagnostic, running }, state = running ? 'checking' : diagnostic?.state === 'pass' || diagnostic?.state === 'fail' ? diagnostic.state : 'unknown';
    const selected = m.selectedSet.has(id), current = m.currentId === id, tab = current ? 0 : -1, peeking = m.peekId === id;
    const endpoint = m.duplicateEndpoint(profile), address = proxyEndpointLabel(profile.host, profile.port);
    const more = m.menu === 'row:' + id;
    const cells = {
      ...(m.geo?.columns.length ? geoCells(m, profile, checked, tab) : null),
      select: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--select', 'data-col': 'select', children: h('input', { type: 'checkbox', class: 'pm-check-input', checked: selected, tabIndex: tab, disabled: m.busy && !m.checkingProfiles, 'aria-label': t('select_profile') + ': ' + name, 'data-proxy-select': id, onClick: event => m.selectClick(id, event) }) }),
      name: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--name', 'data-col': 'name', children: h('button', { type: 'button', class: 'pm-name', tabIndex: tab, 'aria-haspopup': 'dialog', 'aria-expanded': peeking, 'data-proxy-open': id, onClick: () => m.openPeek(id), children: [avatar(profile.type), h('span', { class: 'pm-name-text', children: [h('strong', { class: 'pm-name-main', dir: 'auto', children: name }), h('span', { class: 'pm-sub', children: [
        active ? h('span', { class: 'pm-route-tag pm-route-tag--' + activity, 'data-proxy-row-active': id, 'data-state': activity, children: [badgeIcon(activity === 'connected' ? 'pass' : activity === 'connecting' ? 'pending' : 'warning'), t('state_' + activity.replaceAll('-', '_'))] }) : null,
        state === 'fail' ? h('span', { class: 'pm-failed', children: [badgeIcon('fail'), t('check_fail')] }) : null,
        endpoint ? h('small', { class: 'pm-dup', dir: 'ltr', 'data-proxy-duplicate-endpoint': id, children: endpoint }) : null,
      ] })] })] }) }),
      type: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--type', 'data-col': 'type', children: typePill(profile.type) }),
      address: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--address' + (address ? '' : ' is-empty'), 'data-col': 'address', 'data-label': t('column_address'), children: address ? h('button', { type: 'button', class: 'pm-address', dir: 'ltr', tabIndex: tab, title: t('copy_address') + ': ' + address, 'aria-label': t('copy_address') + ': ' + address, 'data-proxy-copy-address': id, onClick: () => m.copyAddress(profile), children: [h('span', { class: 'pm-address-text', children: address }), icon('copy', 13)] }) : h('span', { 'aria-hidden': 'true', children: '—' }) }),
      country: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--country' + (profile.country ? '' : ' is-empty'), 'data-col': 'country', children: countryChip(m, profile) ?? h('span', { 'aria-hidden': 'true', children: '—' }) }),
      linked: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--linked' + (m.linkedOf(id).length ? '' : ' is-empty'), 'data-col': 'linked', children: linkedCell(m, profile) }),
      check: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--check', 'data-col': 'check', children: checkCell(m, profile, info) }),
      ip: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--ip' + (diagnostic?.state === 'pass' && diagnostic.ip ? '' : ' is-empty'), 'data-col': 'ip', 'data-label': t('column_ip'), children: h('span', { class: 'pm-mono', dir: 'ltr', 'data-proxy-profile-ip': id, children: diagnostic?.state === 'pass' ? diagnostic.ip ?? '—' : '—' }) }),
      checked: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--checked' + (checked?.checkedAt ? '' : ' is-empty'), 'data-col': 'checked', 'data-label': t('column_checked'), children: checked?.checkedAt ? relative(m, checked.checkedAt) : h('span', { 'aria-hidden': 'true', children: '—' }) }),
      actions: h('div', { role: 'gridcell', class: 'pm-cell pm-cell--actions', 'data-col': 'actions', children: h('div', { class: 'pm-row-actions', children: [
        iconButton(t('check_connection') + ': ' + name, { disabled: m.busy, tabIndex: tab, 'data-proxy-check-profile': id, onClick: () => m.checkOne(id) }, 'check'),
        active ? iconButton(t('disconnect') + ': ' + name, { disabled: m.busy, tabIndex: tab, class: 'is-active', 'data-proxy-disconnect-profile': id, onClick: () => m.disconnect() }, 'disconnect')
          : iconButton(t('connect') + ': ' + name, { disabled: m.busy || m.state === 'connecting', tabIndex: tab, 'data-proxy-connect': id, onClick: () => m.connect(profile) }, 'connect'),
        menu(m, { id: 'row:' + id, label: t('more_actions') + ': ' + name, glyph: 'more', triggerProps: { tabIndex: tab, 'data-proxy-more': id }, items: [
          { id: 'edit', label: c('action_edit'), glyph: 'edit', attrs: { 'data-proxy-edit': id }, run: () => m.edit(profile) },
          { id: 'duplicate', label: t('duplicate'), glyph: 'plus', attrs: { 'data-proxy-duplicate': id }, run: () => m.duplicate(profile) },
          { id: 'copy', label: t('copy_json'), glyph: 'copy', danger: true, attrs: { 'data-proxy-copy-profile': id }, run: () => m.copyJson(id) },
          { id: 'remove', label: c('action_remove'), glyph: 'delete', danger: true, disabled: active, attrs: { 'data-proxy-remove': id }, run: () => m.askRemove([id]) },
        ] }),
      ] }) }),
    };
    return h('div', { key: id, role: 'row', id: 'pm-row-' + id, class: 'pm-row pm-proto--' + profile.type + (selected ? ' is-selected' : '') + (current ? ' is-current' : '') + (active ? ' is-active' : '') + (chosen && !active ? ' is-chosen' : '') + (state === 'fail' ? ' is-failed' : '') + (peeking ? ' is-peeking' : '') + (more ? ' has-menu' : ''), 'aria-rowindex': index + 2, 'aria-selected': selected, tabIndex: tab, 'data-proxy-profile': id, 'data-state': state, onFocus: event => m.rowFocus(id, event), children: [cells.select, cells.name, h('div', { class: 'pm-meta', role: 'presentation', children: metaColumns(m).map(column => cells[column]) }), cells.actions] });
  }
  const columnHead = (m, column, label, sortKey, title) => {
    const current = Boolean(sortKey) && m.view.sort === sortKey;
    return h('div', { role: 'columnheader', class: 'pm-cell pm-head pm-cell--' + column + (current ? ' is-sorted' : ''), 'data-col': column, title, 'aria-sort': current ? (m.view.dir === 'desc' ? 'descending' : 'ascending') : sortKey ? 'none' : undefined, children: sortKey
      ? h('button', { type: 'button', class: 'pm-sort', disabled: m.busy, 'data-proxy-sort-column': sortKey, onClick: () => m.sortBy(sortKey), children: [h('span', { children: label }), current ? icon(m.view.dir === 'desc' ? 'down' : 'up', 13) : null] })
      : h('span', { class: 'pm-head-label', children: label }) });
  };
  function headerRow(m) {
    const all = m.shown.length > 0 && m.shown.every(profile => m.selectedSet.has(profile.id)), some = m.shown.some(profile => m.selectedSet.has(profile.id));
    const heads = {
      select: h('div', { role: 'columnheader', class: 'pm-cell pm-head pm-cell--select', 'data-col': 'select', children: h('input', { type: 'checkbox', class: 'pm-check-input', checked: all, indeterminate: some && !all, disabled: m.busy && !m.checkingProfiles, 'aria-label': t('select_all_rows'), 'data-proxy-select-all': true, onClick: () => m.toggleAll() }) }),
      name: columnHead(m, 'name', c('field_name'), 'name'),
      type: columnHead(m, 'type', c('field_type'), 'type'),
      address: columnHead(m, 'address', t('column_address'), 'host'),
      country: columnHead(m, 'country', t('country_short'), 'country'),
      linked: columnHead(m, 'linked', t('column_linked'), null),
      check: columnHead(m, 'check', t('check_result'), 'latency'),
      ip: columnHead(m, 'ip', t('column_ip'), null),
      checked: columnHead(m, 'checked', t('column_checked'), 'checked'),
      actions: h('div', { role: 'columnheader', class: 'pm-cell pm-head pm-cell--actions', 'data-col': 'actions', children: h('span', { class: 'proxy-workspace-sr', children: c('actions') }) }),
    };
    const geoHeads = Object.fromEntries((m.geo?.columns ?? []).map(column => [column, columnHead(m, column, m.geo.t('col_' + column), null, m.geo.t(column === 'geotime' ? 'col_geotime_title' : 'col_source_title'))]));
    return h('div', { role: 'row', class: 'pm-row pm-row--head', 'aria-rowindex': 1, children: [heads.select, heads.name, h('div', { class: 'pm-meta', role: 'presentation', children: metaColumns(m).map(column => heads[column] ?? geoHeads[column]) }), heads.actions] });
  }
  function grid(m) {
    const geoColumns = m.geo?.columns ?? [], hidden = COLUMN_ORDER.filter(column => !['select', 'name', 'actions'].includes(column) && !m.view.columns.includes(column));
    return h('div', { class: 'pm-gridbox', children: [
      h('div', { class: 'pm-grid pm-density--' + m.view.density + hidden.map(column => ' pm-off-' + column).join('') + geoColumns.map((column, index) => (index === 0 ? ' pm-geo' : '') + ' pm-on-' + column).join(''), role: 'grid', 'aria-label': t('profiles'), 'aria-rowcount': m.shown.length + 1, 'aria-colcount': 2 + m.view.columns.length + geoColumns.length + 1, 'aria-multiselectable': 'true', 'aria-describedby': 'pm-keys', 'data-proxy-table': true, ref: m.gridRef, onKeyDown: m.onGridKey, children: [headerRow(m), ...m.shown.map((profile, index) => row(m, profile, index))] }),
      h('p', { id: 'pm-keys', class: 'pm-keys', children: t('keyboard_hint') }),
    ] });
  }

  // ---- Geolocation: menus, notice, confirmation (ADR-109) ----------------------------------------------------------------------------
  const GEO_GLYPHS = Object.freeze({ geo: 'globe', geonet: 'route', geokind: 'proxy', geoflags: 'shield', geotime: 'history' });
  // The second group of the columns menu: one checkbox per geolocation column (the selection is stored by the geolocation controller).
  const geoColumnsGroup = m => ({ id: 'geo-columns', group: true, label: m.geo.t('col_group'), items: GEO_COLUMNS.map(column => ({ id: 'geo-' + column, label: m.geo.t('col_' + column), glyph: GEO_GLYPHS[column], role: 'menuitemcheckbox', checked: m.geo.columns.includes(column), attrs: { 'data-proxy-geo-column': column }, run: () => m.geo.toggleColumn(column) })) });
  // "Look up all" is shown while the feature is on and says why it is unavailable instead of hiding.
  function geoLookupAllItem(m) {
    const geo = m.geo, reason = !geo.ready ? geo.t('cell_not_ready') : geo.targets === 0 ? geo.t('lookup_all_none') : '';
    return { id: 'geo-lookup-all', label: geo.t('lookup_all'), glyph: 'globe', disabled: reason !== '', note: reason || undefined, title: reason || undefined, attrs: { 'data-proxy-geo-lookup-all': true }, run: () => geo.askLookupAll() };
  }
  // The dismissible notice above the list: an invitation while the feature is off, a reminder while it is on without a ready provider.
  // The link opens the settings page in a new tab (a real link, so the usual browser actions work too).
  function geoBanner(m) {
    const geo = m.geo;
    if (!geo || geo.banner === 'hidden') return null;
    const invite = geo.banner === 'invite', g = geo.t;
    return h('div', { class: 'pm-geo-banner pm-geo-banner--' + geo.banner, role: 'region', 'aria-label': g('banner_region'), 'data-proxy-geo-banner': geo.banner, children: [
      icon('globe', 18),
      h('p', { class: 'pm-geo-banner-text', children: invite ? g('banner_invite') : g('banner_not_ready') }),
      h('a', { class: 'pm-geo-banner-link', href: 'proxy-geo-settings.html', target: '_blank', rel: 'noopener', 'data-proxy-geo-banner-link': true, onClick: event => geo.openSettings(event), children: [h('span', { children: g('banner_link') }), h('span', { class: 'proxy-workspace-sr', children: g('banner_new_tab') }), icon('external', 13)] }),
      invite ? iconButton(g('banner_dismiss'), { 'data-proxy-geo-banner-dismiss': true, onClick: () => geo.dismissBanner() }, 'close') : null,
    ] });
  }
  // The inline confirmation of "look up all": the number of distinct addresses and the provider that gets them, before anything is sent.
  function geoConfirm(m) {
    const geo = m.geo, confirm = geo?.confirm;
    if (!confirm) return null;
    return h('div', { class: 'pm-geo-confirm', role: 'group', 'aria-label': geo.t('confirm_label'), 'data-proxy-geo-confirm': String(confirm.count), children: [
      icon('globe', 18),
      h('div', { class: 'pm-geo-confirm-body', children: [h('p', { class: 'pm-geo-confirm-text', children: geo.confirmText(confirm) }), h('p', { class: 'pm-muted', children: geo.t('confirm_note') })] }),
      h('div', { class: 'pm-bar-actions', children: [button(geo.t('confirm_no'), { 'data-proxy-geo-confirm-no': true, onClick: () => geo.cancelLookupAll() }), button(geo.t('confirm_yes'), { class: 'button button--primary', 'data-proxy-geo-confirm-yes': true, onClick: () => geo.confirmLookupAll() }, 'search')] }),
    ] });
  }

  // ---- Header, filters ---------------------------------------------------------------------------------------------------------------
  function listHeader(m) {
    const total = m.profiles.length, shownCount = m.shown.length, filtered = m.hasFilters && shownCount !== total;
    return h('header', { class: 'pm-listhead', 'data-tour': 'proxy', children: [
      h('div', { class: 'pm-listtitle', children: [h('h3', { children: t('profiles') }), h('span', { class: 'pm-count', 'data-proxy-count': filtered ? 'filtered' : 'all', 'aria-label': fill(t('count_filtered'), { shown: shownCount, total }), children: filtered ? fill(t('count_filtered'), { shown: shownCount, total }) : String(total) })] }),
      h('div', { class: 'pm-listtools', children: [
        h('label', { class: 'pm-search', children: [h('span', { class: 'proxy-workspace-sr', children: c('search') }), icon('search', 16), h('input', { type: 'search', value: m.filters.query, placeholder: c('search'), disabled: m.busy && !m.checkingProfiles, ref: m.searchRef, 'aria-keyshortcuts': '/', 'data-proxy-search': true, onInput: event => m.setFilter('query', event.currentTarget.value) })] }),
        button(t('check_visible'), { class: 'button pm-check-all', 'aria-label': t('check_visible'), title: t('check_visible'), disabled: m.busy || !m.shown.length, 'data-proxy-check-visible': true, onClick: () => m.checkVisible() }, 'check'),
        h('div', { class: 'pm-add', children: [
          button(t('new_profile'), { class: 'button button--primary pm-add-main', disabled: m.busy || !m.configuration, 'data-proxy-new': true, onClick: () => m.openNew() }, 'plus'),
          menu(m, { id: 'add', label: t('more_actions'), glyph: 'caret', class: 'pm-add-menu', triggerProps: { class: 'button button--primary pm-add-caret', disabled: m.busy || !m.configuration, 'data-proxy-new-menu': true }, items: [
            { id: 'type-socks5', label: t('new_profile') + ': SOCKS5', glyph: 'socks5', attrs: { 'data-proxy-new-type': 'socks5' }, run: () => m.openNew('socks5') },
            { id: 'bulk', label: t('bulk_import'), glyph: 'import', attrs: { 'data-proxy-bulk-open': true, 'aria-haspopup': 'dialog' }, run: () => m.openBulk() },
            { id: 'file', label: t('choose_file'), glyph: 'file', attrs: { 'data-proxy-import-file': true }, run: () => m.openOpenVpnFile() },
          ] }),
        ] }),
        menu(m, { id: 'list', label: t('more_actions'), glyph: 'more', triggerProps: { 'data-proxy-list-menu': true }, items: [
          { id: 'copy-all', label: t('copy_all'), glyph: 'copy', danger: true, disabled: !m.profiles.length, attrs: { 'data-proxy-copy-all': true }, run: () => m.copyJson(null) },
          m.geo?.on ? geoLookupAllItem(m) : null,
        ] }),
        iconButton(t('help'), { 'aria-expanded': m.helpOpen, 'aria-controls': 'pm-help', 'data-proxy-help': true, class: m.helpOpen ? 'is-active' : '', onClick: () => m.toggleHelp() }, 'help'),
      ] }),
    ] });
  }
  // `stop` marks the one chip of its group that Tab reaches (roving tabindex); the others are reached with the arrow keys.
  function chip(label, count, pressed, stop, properties) {
    return h('button', { type: 'button', class: 'pm-chip' + (pressed ? ' is-on' : ''), 'aria-pressed': pressed, tabIndex: stop ? 0 : -1, ...properties, children: [h('span', { class: 'pm-chip-label', children: label }), count == null ? null : h('span', { class: 'pm-chip-count', children: String(count) })] });
  }
  function filters(m) {
    const f = m.filters, facets = m.facets;
    const statusLabel = { all: t('chip_all'), pass: t('chip_pass'), fail: t('chip_fail'), unchecked: t('chip_unchecked') };
    const active = [];
    if (f.type !== 'all') active.push({ key: 'type', label: TYPE_LABELS[f.type] });
    if (f.status !== 'all') active.push({ key: 'status', label: statusLabel[f.status] });
    if (f.country !== 'all') active.push({ key: 'country', label: f.country === 'none' ? t('country_none') : f.country + ' · ' + (regionName(m.locale, f.country) ?? f.country) });
    // The tab stop of a group is the chip that last had the focus, or the one that is on.
    const typeKeys = ['all', ...PROXY_TYPES.filter(type => facets.type[type] > 0 || f.type === type)], typeStop = typeKeys.includes(m.chipStops.type) ? m.chipStops.type : f.type;
    const statusStop = PROXY_STATUS_FILTERS.includes(m.chipStops.status) ? m.chipStops.status : f.status;
    const parts = [
      h('div', { class: 'pm-chipgroup', children: [h('span', { class: 'pm-chipgroup-label', 'aria-hidden': 'true', children: c('field_type') }), h('div', { class: 'pm-chips', role: 'toolbar', 'aria-orientation': 'horizontal', 'aria-label': c('field_type'), 'data-proxy-filter': true, onKeyDown: m.onChipKey, children: [
        chip(t('chip_all'), facets.type.all, f.type === 'all', typeStop === 'all', { 'data-proxy-filter-type': 'all', onFocus: () => m.focusChip('type', 'all'), onClick: () => m.setFilter('type', 'all') }),
        ...typeKeys.slice(1).map(type => chip(TYPE_LABELS[type], facets.type[type], f.type === type, typeStop === type, { 'data-proxy-filter-type': type, onFocus: () => m.focusChip('type', type), onClick: () => m.setFilter('type', f.type === type ? 'all' : type) })),
      ] })] }),
      h('div', { class: 'pm-chipgroup', children: [h('span', { class: 'pm-chipgroup-label', 'aria-hidden': 'true', children: t('check_result') }), h('div', { class: 'pm-chips', role: 'toolbar', 'aria-orientation': 'horizontal', 'aria-label': t('check_result'), 'data-proxy-status-filter': true, onKeyDown: m.onChipKey, children: PROXY_STATUS_FILTERS.map(status => chip(statusLabel[status], facets.status[status], f.status === status, statusStop === status, { 'data-proxy-status-chip': status, onFocus: () => m.focusChip('status', status), onClick: () => m.setFilter('status', status) })) })] }),
      h('div', { class: 'pm-filter-tools', children: [
        m.countries.length ? menu(m, { id: 'country', label: t('country_short'), glyph: 'globe', align: 'start', text: f.country === 'all' ? t('country_short') : f.country === 'none' ? t('country_none') : f.country, caret: true, triggerProps: { class: 'button pm-toolbtn' + (f.country !== 'all' ? ' is-on' : ''), 'data-proxy-country-filter': true, allowBusy: false }, items: [
          { id: 'all', label: t('chip_all'), glyph: 'globe', role: 'menuitemradio', checked: f.country === 'all', run: () => m.setFilter('country', 'all') },
          ...m.countries.map(entry => ({ id: entry.code, label: entry.code + ' · ' + (regionName(m.locale, entry.code) ?? entry.code) + ' (' + entry.count + ')', glyph: 'globe', role: 'menuitemradio', checked: f.country === entry.code, attrs: { 'data-proxy-country-option-filter': entry.code }, run: () => m.setFilter('country', entry.code) })),
          m.countries.length && m.profiles.some(profile => !profile.country) ? { id: 'none', label: t('country_none'), glyph: 'globe', role: 'menuitemradio', checked: f.country === 'none', run: () => m.setFilter('country', 'none') } : null,
        ] }) : null,
        h('label', { class: 'pm-select', children: [h('span', { class: 'proxy-workspace-sr', children: t('sort_by') }), icon('sort', 15), h('select', { value: m.view.sort, title: t('sort_by'), disabled: m.busy && !m.checkingProfiles, 'data-proxy-sort': true, onChange: event => m.setSort(event.currentTarget.value), children: [['name', c('field_name')], ['type', c('field_type')], ['host', t('host')], ['country', t('country_short')], ['latency', t('latency')], ['health', t('check_result')], ['checked', t('last_check')]].filter(([value]) => PROXY_VIEW_SORTS.includes(value)).map(([value, label]) => h('option', { value, children: label })) })] }),
        iconButton(t('sort_reverse'), { 'aria-pressed': m.view.dir === 'desc', 'data-proxy-sort-dir': m.view.dir, onClick: () => m.setSortDir(m.view.dir === 'desc' ? 'asc' : 'desc') }, m.view.dir === 'desc' ? 'down' : 'up'),
        h('div', { class: 'pm-seg', role: 'toolbar', 'aria-orientation': 'horizontal', 'aria-label': t('density'), 'data-proxy-density': m.view.density, onKeyDown: m.onChipKey, children: ['comfortable', 'compact'].map(value => h('button', { type: 'button', class: 'pm-seg-btn' + (m.view.density === value ? ' is-on' : ''), 'aria-pressed': m.view.density === value, tabIndex: (['comfortable', 'compact'].includes(m.chipStops.density) ? m.chipStops.density : m.view.density) === value ? 0 : -1, onFocus: () => m.focusChip('density', value), title: t('density_' + value), 'aria-label': t('density_' + value), 'data-proxy-density-option': value, onClick: () => m.setDensity(value), children: icon(value === 'compact' ? 'rows' : 'panel', 15) })) }),
        menu(m, { id: 'columns', label: t('columns'), glyph: 'columns', triggerProps: { 'data-proxy-columns-menu': true, allowBusy: true }, items: m.columnChoices.map(choice => ({ id: choice.key, label: choice.label, glyph: choice.glyph, role: 'menuitemcheckbox', checked: m.view.columns.includes(choice.key), attrs: { 'data-proxy-column-toggle': choice.key }, run: () => m.toggleColumn(choice.key) })).concat(m.geo?.on ? [geoColumnsGroup(m)] : []).concat([{ id: 'reset-view', label: t('reset_view'), glyph: 'history', attrs: { 'data-proxy-view-reset': true }, run: () => m.resetView() }]) }),
      ] }),
      active.length ? h('div', { class: 'pm-active-filters', 'data-proxy-active-filters': String(active.length), children: [
        ...active.map(entry => h('button', { type: 'button', class: 'pm-chip pm-chip--active', 'aria-label': t('remove_filter') + ': ' + entry.label, 'data-proxy-filter-remove': entry.key, onClick: () => m.setFilter(entry.key, 'all'), children: [h('span', { class: 'pm-chip-label', children: entry.label }), icon('close', 12)] })),
        h('button', { type: 'button', class: 'pm-linkbtn', 'data-proxy-filters-clear': true, onClick: () => m.clearFilters(), children: t('clear_filters') }),
      ] }) : null,
    ];
    // The applied filters stay visible when the chips are folded away on a phone.
    const strip = parts.pop();
    return h('div', { class: 'pm-filters-wrap' + (m.filtersOpen ? ' is-open' : ''), children: [
      h('button', { type: 'button', class: 'button pm-filters-toggle', 'aria-expanded': m.filtersOpen, 'aria-controls': 'pm-filters', 'data-proxy-filters-toggle': true, onClick: () => m.toggleFilters(), children: [icon('filter', 16), h('span', { children: t('filters') }), active.length ? h('span', { class: 'pm-chip-count pm-filters-count', children: String(active.length) }) : null, icon('caret', 14)] }),
      h('div', { class: 'pm-filters', id: 'pm-filters', children: parts }),
      strip,
    ] });
  }

  // ---- Action bar ----------------------------------------------------------------------------------------------------------------------
  // One sticky bar at the bottom of the list with four modes: nothing (absent), selection, a running bulk check (with its progress),
  // a finished bulk check (the summary) and a delete confirmation.
  function actionBar(m) {
    const progress = m.checkingProfiles, summary = m.batchSummary, removing = m.removing, selected = m.selection.length;
    if (removing) {
      const first = m.profiles.find(profile => profile.id === removing[0]);
      return h('div', { class: 'pm-bar pm-bar--confirm', role: 'group', 'aria-label': t('delete_confirmation'), 'data-proxy-removal': true, children: [
        icon('warning', 18),
        h('p', { class: 'pm-bar-text', children: removing.length === 1 ? t('delete_confirmation') + ' ' + (first?.name ?? '') : fill(t('delete_selected_confirm'), { count: removing.length }) }),
        h('div', { class: 'pm-bar-actions', children: [button(c('cancel'), { disabled: m.busy, 'data-proxy-remove-cancel': true, onClick: () => m.cancelRemove() }), button(c('action_remove'), { class: 'button pm-danger', disabled: m.busy, 'data-proxy-remove-confirm': true, onClick: () => m.confirmRemove() }, 'delete')] }),
      ] });
    }
    if (progress) {
      const done = progress.done ?? 0, total = progress.ids.length, failed = progress.failed ?? 0, percent = total ? Math.round(done / total * 100) : 0;
      return h('div', { class: 'pm-bar pm-bar--progress', role: 'status', 'data-proxy-check-progress': true, children: [
        spinner(16),
        h('div', { class: 'pm-bar-body', children: [
          h('p', { class: 'pm-bar-text', children: progress.stopping ? t('stopping') : fill(t('check_progress'), { done, total, failed }) }),
          h('div', { class: 'pm-meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done, 'aria-label': t('checking'), children: h('span', { class: 'pm-meter-fill', style: 'inline-size:' + percent + '%' }) }),
        ] }),
        h('div', { class: 'pm-bar-actions', children: button(c('cancel'), { disabled: progress.stopping, 'data-proxy-stop-checks': true, onClick: () => m.stopChecks() }) }),
      ] });
    }
    if (selected) {
      return h('div', { class: 'pm-bar pm-bar--selection', role: 'toolbar', 'aria-label': fill(t('selected_count'), { count: selected }), 'data-proxy-bulkbar': String(selected), children: [
        summary ? h('div', { class: 'pm-bar-summary' + (summary.failed ? ' is-warn' : ''), role: 'status', 'data-proxy-check-summary': String(summary.done), children: [icon(summary.failed ? 'warning' : 'pass', 16), h('p', { class: 'pm-bar-text', children: fill(t('check_summary'), { done: summary.done, total: summary.total, passed: summary.passed, failed: summary.failed }) }), iconButton(t('close'), { 'data-proxy-summary-close': true, onClick: () => m.dismissSummary() }, 'close')] }) : null,
        h('p', { class: 'pm-bar-text pm-bar-count', 'data-proxy-selected-count': String(selected), children: fill(t('selected_count'), { count: selected }) }),
        h('div', { class: 'pm-bar-actions', children: [
          button(t('check_selected'), { class: 'button', disabled: m.busy, 'data-proxy-check-selected': true, onClick: () => m.checkSelected() }, 'check'),
          button(t('delete_selected'), { class: 'button pm-danger', disabled: m.busy || m.deletable.length === 0, 'data-proxy-delete-selected': true, onClick: () => m.askRemove(m.deletable) }, 'delete'),
          button(t('clear_selection'), { class: 'button button--text', 'data-proxy-clear-selection': true, onClick: () => m.clearSelection() }),
        ] }),
      ] });
    }
    if (summary) {
      return h('div', { class: 'pm-bar pm-bar--summary', role: 'status', 'data-proxy-check-summary': String(summary.done), children: [
        icon(summary.failed ? 'warning' : 'pass', 18),
        h('p', { class: 'pm-bar-text', children: fill(t('check_summary'), { done: summary.done, total: summary.total, passed: summary.passed, failed: summary.failed }) }),
        h('div', { class: 'pm-bar-actions', children: iconButton(t('close'), { 'data-proxy-summary-close': true, onClick: () => m.dismissSummary() }, 'close') }),
      ] });
    }
    return null;
  }

  // ---- Empty, loading, error ----------------------------------------------------------------------------------------------------------
  function emptyState(m) {
    return h('div', { class: 'pm-blank pm-blank--empty', 'data-proxy-empty': true, children: [
      illustration(),
      h('h4', { class: 'pm-blank-title', children: t('empty_title') }),
      h('p', { class: 'pm-blank-text', children: t('empty_detail') }),
      h('div', { class: 'pm-blank-actions', children: [
        button(t('new_profile'), { class: 'button button--primary', disabled: m.busy || !m.configuration, 'data-proxy-empty-new': true, onClick: () => m.openNew() }, 'plus'),
        button(t('bulk_import'), { disabled: m.busy || !m.configuration, 'data-proxy-empty-bulk': true, onClick: () => m.openBulk() }, 'import'),
        button(t('choose_file'), { disabled: m.busy || !m.configuration, 'data-proxy-empty-file': true, onClick: () => m.openOpenVpnFile() }, 'file'),
      ] }),
    ] });
  }
  function noResults(m) {
    return h('div', { class: 'pm-blank pm-blank--none', 'data-proxy-no-results': true, role: 'status', children: [
      icon('search', 26),
      h('p', { class: 'pm-blank-text', children: t('no_results') }),
      h('div', { class: 'pm-blank-actions', children: button(t('clear_filters'), { 'data-proxy-filters-clear': true, onClick: () => m.clearFilters() }) }),
    ] });
  }
  function skeleton() {
    return h('div', { class: 'pm-skeleton', 'data-proxy-skeleton': true, role: 'status', 'aria-busy': 'true', children: [
      h('span', { class: 'proxy-workspace-sr', children: t('loading') }),
      ...[0, 1, 2, 3, 4].map(index => h('div', { class: 'pm-skeleton-row', 'aria-hidden': 'true', key: index, children: [h('span', { class: 'pm-skel pm-skel--avatar' }), h('span', { class: 'pm-skel pm-skel--name' }), h('span', { class: 'pm-skel pm-skel--pill' }), h('span', { class: 'pm-skel pm-skel--addr' }), h('span', { class: 'pm-skel pm-skel--pill' })] })),
    ] });
  }
  function errorState(m) {
    return h('div', { class: 'pm-blank pm-blank--error', 'data-proxy-load-failed': true, role: 'alert', children: [
      icon('warning', 26),
      h('p', { class: 'pm-blank-text', children: m.errorText }),
      m.errorCode ? h('code', { class: 'pm-error-code', dir: 'ltr', children: m.errorCode }) : null,
      h('div', { class: 'pm-blank-actions', children: button(t('retry_load'), { class: 'button button--primary', disabled: m.busy, 'data-proxy-retry': true, onClick: () => m.reload() }, 'history') }),
    ] });
  }

  return { grid, listHeader, geoBanner, geoConfirm, filters, actionBar, emptyState, noResults, skeleton, errorState, menu, typePill, avatar, countryChip, checkCell, microChip, relative, button, iconButton };
}
