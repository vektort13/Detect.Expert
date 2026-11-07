// ADR-030/031/032: one live and Pro presentation of validated inspection metadata.
import { readBeaconSnapshot, readBeaconDocuments } from './beacon-contracts.js';
import { createCompanyUi } from './company-ui.js';
import { readBackgroundSnapshot, readBackgroundDocuments } from './background-activity-contracts.js';
import { readCookieProbeSnapshot, readCookieProbeDocuments } from './cookie-probe-contracts.js';

export function createAdvancedUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome }) {
  const { CompanyLabel } = createCompanyUi({ h });
  const text = (key, substitutions = []) => translate(key, substitutions);
  const normalized = value => value.replace(/-/g, '_');
  const serviceNames = { 'google-analytics': 'Google Analytics 4', 'google-ads': 'Google Ads', meta: 'Meta', tiktok: 'TikTok', yandex: 'Yandex Metrica', linkedin: 'LinkedIn' };
  const identifierKeys = ['clientId', 'browserId', 'sessionId', 'userId', 'hashedEmail', 'hashedPhone'];
  const consentKeys = ['gcs', 'gcd', 'adUserData', 'adPersonalization'];
  const eventLabels = { purchase: 'purchase', Purchase: 'purchase', CompletePayment: 'purchase', page_view: 'page_view', PageView: 'page_view', pageview: 'page_view', view_item: 'view_item', ViewContent: 'view_item', add_to_cart: 'add_to_cart', AddToCart: 'add_to_cart', generate_lead: 'lead', Lead: 'lead', begin_checkout: 'checkout', InitiateCheckout: 'checkout', login: 'login', sign_up: 'signup', CompleteRegistration: 'signup', search: 'search', Search: 'search' };
  const eventText = event => event === 'unknown' ? text('advanced_unknown') : eventLabels[event] ? text('beacon_event_' + eventLabels[event]) + ' (' + event + ')' : event;
  const resource = value => value ? h('code', { dir: 'ltr', children: value.host + value.pathTemplate }) : text('advanced_unknown');
  const fact = (key, value) => h('div', { class: 'advanced-fact', children: [h('dt', { children: text(key) }), h('dd', { children: value })] });
  function useSnapshot(session, visible, type, reader, refreshType = type, rootOnly = false) {
    const frameId = rootOnly ? 0 : session.selectedFrameId;
    const report = rootOnly ? frameId === session.selectedFrameId ? session.report : session.frameOverviews?.find(row => row.frameId === 0) : session.report;
    const documentKey = report?.documentKey ?? null;
    const identity = [session.tabId, frameId, documentKey, report?.observedSince ?? 'none'].join('|');
    const eligible = session.loaded && !session.busy && session.tabId !== null && documentKey !== null && !['paused', 'no-access', 'unsupported'].includes(report?.coverageState);
    const [current, setCurrent] = useState({ identity: '', state: null, pending: false });
    const mounted = useRef(false), generation = useRef(0), active = useRef(null), latest = useRef(null);
    latest.current = { identity, eligible, visible, request: { schemaVersion: 1, type, tabId: session.tabId, frameId, documentKey } };
    const read = async (refresh = false, handle = undefined, command = undefined) => {
      const context = latest.current;
      if (!mounted.current || !context.eligible || active.current) return null;
      const token = ++generation.current, job = {};
      active.current = job;
      setCurrent(previous => ({ identity: context.identity, state: previous.identity === context.identity ? previous.state : null, pending: true }));
      let timer;
      try {
        const request = { ...context.request, type: command ?? (refresh ? refreshType : type) };
        if (handle !== undefined) request.handle = handle;
        const value = await Promise.race([browserApi.runtime.sendMessage(request), new Promise(resolve => { timer = setTimeout(() => resolve(null), 15000); })]);
        const state = reader(value);
        if (mounted.current && generation.current === token && latest.current.identity === context.identity && latest.current.eligible) {
          const safe = state?.documentKey === context.request.documentKey ? state : null;
          setCurrent({ identity: context.identity, state: safe, pending: false });
          return safe;
        }
      } catch {
        if (mounted.current && generation.current === token) setCurrent({ identity: context.identity, state: null, pending: false });
      } finally { if (timer !== undefined) clearTimeout(timer); if (active.current === job) active.current = null; }
      return null;
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
    useEffect(() => {
      ++generation.current;
      setCurrent({ identity, state: null, pending: false });
    }, [identity, eligible]);
    useEffect(() => {
      if (!eligible || !visible) return;
      void read();
      const timer = setInterval(() => { if (latest.current.visible) void read(); }, 1200);
      return () => { clearInterval(timer); ++generation.current; };
    }, [identity, eligible, visible]);
    return { state: current.identity === identity && eligible ? current.state : null, pending: current.identity === identity && current.pending, eligible, refresh: () => read(true), read };
  }
  const useBeacons = (session, visible) => useSnapshot(session, visible, 'ui-get-beacons', readBeaconSnapshot);
  const useBackgroundActivity = (session, visible) => useSnapshot(session, visible, 'ui-get-background-activity', readBackgroundSnapshot, 'ui-refresh-background-activity');
  function useCookieProbe(session, visible) {
    const value = useSnapshot(session, visible, 'ui-get-cookie-probe', readCookieProbeSnapshot, 'ui-get-cookie-probe');
    return { ...value, eligible: value.eligible && session.selectedFrameId === 0, start: handle => session.selectedFrameId === 0 ? value.read(false, handle, 'ui-start-cookie-probe') : null, cancel: () => value.read(false, undefined, 'ui-cancel-cookie-probe') };
  }
  function BeaconRows({ state }) {
    useLocale();
    const items = [...state.rows.map(row => ({ row, source: 'beacon_browser_requests' })), ...state.scriptCalls.map(row => ({ row, source: 'beacon_page_calls' }))];
    return h('div', { class: 'advanced-rows', 'data-beacon-rows': true, children: items.map(({ row, source }, index) => h('article', { class: 'advanced-card', 'data-beacon-row': index, 'data-beacon-source': row.evidenceSource, key: index, children: [
      h('h3', { children: h(CompanyLabel, { name: serviceNames[row.service], identity: row.service }) }),
      h('p', { children: text(source) }),
      h('p', { class: 'advanced-event', children: row.events.length ? row.events.map(eventText).join(' · ') : text('advanced_unknown') }),
      h('dl', { class: 'advanced-facts', children: [
        row.money.length ? fact('beacon_money', row.money.map((item, moneyIndex) => h('p', { key: moneyIndex, children: [text('beacon_money_' + normalized(item.purpose)), ': ', item.value, item.currency ? ' ' + item.currency : '', item.event !== 'unknown' ? ' · ' + eventText(item.event) : ''] }))) : null,
        fact('beacon_identifiers', h('dl', { children: identifierKeys.map(key => fact('beacon_id_' + key, text('advanced_presence_' + row.identifiers[key]))) })),
        fact('beacon_consent', h('dl', { children: consentKeys.map(key => fact('beacon_consent_' + key, text('advanced_presence_' + row.consent[key]))) })),
        fact('beacon_fields', row.parameterNames.length ? row.parameterNames.map(key => text('beacon_field_' + normalized(key))).join(' · ') : '—'),
        fact('beacon_transport', row.method + ' · ' + row.requestType),
        fact('third_party_domain', row.destinationHost),
        fact('beacon_request_count', String(row.count)),
        fact('third_party_status', row.evidenceSource === 'browser-network' ? [row.statusCodes.join(', ') || '—', ' · ', text('third_party_completed') + ': ' + row.completedCount, ' · ', text('third_party_failed') + ': ' + row.failedCount] : '—'),
        fact('beacon_script', resource(row.script)),
        fact('third_party_initiator', row.initiatorHost ?? text('advanced_unknown')),
        fact('beacon_decode', text('beacon_decode_' + normalized(row.decodeStatus))),
        fact('detail_evidence', text('evidence_' + normalized(row.evidenceSource)))
      ] })
    ] })) });
  }
  function BeaconPanel({ beacons }) {
    useLocale();
    return h('section', { class: 'advanced-inspector', 'data-beacon-panel': true, children: [
      h('div', { class: 'advanced-heading', children: [h('h2', { children: text('beacon_title') }), h('button', { type: 'button', class: 'button', disabled: beacons.pending || !beacons.eligible, onClick: beacons.refresh, children: text('action_refresh') })] }),
      beacons.state ? [h('p', { children: text('beacon_total', [String(beacons.state.requestCount)]) }), beacons.state.rows.length || beacons.state.scriptCalls.length ? h(BeaconRows, { state: beacons.state }) : h('p', { children: text('beacon_empty') }), beacons.state.truncated ? h('p', { role: 'status', children: text('advanced_truncated') }) : null] : h('p', { role: 'status', children: text(beacons.pending ? 'statusLoading' : 'advanced_unavailable') })
    ] });
  }
  function BackgroundRows({ state }) {
    const locale = useLocale(), inventory = state.inventory;
    const inspectionUnavailable = inventory.checkedAt > 0 && inventory.status === 'unsupported';
    const labels = { serviceWorker: 'Service Worker', push: 'Web Push', sync: 'Background Sync', periodicSync: 'Periodic Background Sync' };
    let checked = text('background_not_checked');
    if (inventory.checkedAt > 0) { try { checked = text('background_checked_at') + ': ' + new Intl.DateTimeFormat(({ zh_CN: 'zh-CN', pt_BR: 'pt-BR', yue: 'zh-CN', wuu: 'zh-CN' })[locale] ?? locale ?? 'en', { dateStyle: 'medium', timeStyle: 'medium' }).format(inventory.checkedAt); } catch { checked = text('background_checked_at') + ': ' + new Date(inventory.checkedAt).toISOString(); } }
    return h('div', { 'data-background-results': true, children: [
      h('p', { 'data-background-checked': inventory.checkedAt, children: checked }),
      inspectionUnavailable ? h('p', { role: 'status', 'data-background-inventory-unavailable': true, children: text('advanced_unavailable') }) : h('div', { class: 'advanced-capabilities', children: Object.entries(labels).map(([key, label]) => h('article', { class: 'advanced-card', 'data-background-capability': key, children: [h('h3', { children: label }), h('dl', { class: 'advanced-facts', children: [
        fact('background_api', text(inventory.checkedAt === 0 ? 'advanced_unknown' : inventory.supported[key] ? 'advanced_supported' : 'advanced_unsupported')),
        key === 'serviceWorker' ? fact('background_registrations', inventory.registrationCount ?? text('advanced_unknown')) : fact('background_permission', text('advanced_presence_' + inventory.permissions[key])),
        key === 'push' ? fact('background_subscriptions', inventory.pushSubscriptionCount ?? text('advanced_unknown')) : key === 'sync' ? fact('background_tasks', inventory.syncTagCount ?? text('advanced_unknown')) : key === 'periodicSync' ? fact('background_tasks', inventory.periodicTagCount ?? text('advanced_unknown')) : null
      ] })] })) }),
      !inspectionUnavailable && inventory.registrations.length ? h('section', { 'data-background-registrations': true, children: [h('h3', { children: text('background_registrations') }), ...inventory.registrations.map((row, index) => h('article', { class: 'advanced-card', key: index, children: h('dl', { class: 'advanced-facts', children: [fact('background_scope', resource(row.scope)), fact('background_worker', resource(row.script)), fact('background_state', text('background_state_' + row.state)), fact('background_subscriptions', row.pushSubscribed === null ? text('advanced_unknown') : text(row.pushSubscribed ? 'cookie_yes' : 'cookie_no')), fact('background_sync', row.syncTagCount ?? text('advanced_unknown')), fact('background_periodic_sync', row.periodicTagCount ?? text('advanced_unknown'))] }) }))] }) : null,
      h('h3', { children: text('background_calls') }),
      state.rows.length ? state.rows.map((row, index) => h('article', { class: 'advanced-card', 'data-background-row': index, key: index, children: [h('h4', { children: row.operation }), h('dl', { class: 'advanced-facts', children: [fact('beacon_request_count', row.count), fact('detail_phases', text('phase_' + normalized(row.phase))), fact('beacon_script', resource(row.script)), row.worker ? fact('background_worker', resource(row.worker)) : null, fact('detail_evidence', text('evidence_' + normalized(row.evidenceSource)))] })] })) : h('p', { children: text('background_empty') }),
      state.truncated || inventory.truncated ? h('p', { children: text('advanced_truncated') }) : null
    ] });
  }
  function BackgroundPanel({ backgroundActivity }) {
    useLocale();
    return h('section', { class: 'advanced-inspector', 'data-background-panel': true, children: [h('div', { class: 'advanced-heading', children: [h('h2', { children: text('background_title') }), h('button', { type: 'button', class: 'button', 'data-background-refresh': true, disabled: backgroundActivity.pending || !backgroundActivity.eligible, onClick: backgroundActivity.refresh, children: text('background_check') })] }), backgroundActivity.state ? h(BackgroundRows, { state: backgroundActivity.state }) : h('p', { role: 'status', children: text(backgroundActivity.pending ? 'statusLoading' : 'advanced_unavailable') })] });
  }
  function CookieProbeResult({ state }) {
    useLocale(); if (!state || state.status === 'idle') return null;
    return h('article', { class: 'advanced-card cookie-probe-result', 'data-cookie-probe-result': state.result, role: 'status', children: [h('h3', { children: text('cookie_probe_title') }), h('p', { children: state.cookieName + ' · ' + state.domain }), h('p', { class: 'advanced-event', children: text(state.status === 'preparing' || state.status === 'watching' ? 'cookie_probe_watching' : 'cookie_probe_result_' + normalized(state.result)) }), state.reason !== 'none' ? h('p', { children: text('cookie_probe_reason_' + normalized(state.reason)) }) : null, state.cleanup !== 'none' && state.cleanup !== 'not-needed' ? h('p', { children: text('cookie_probe_cleanup_' + state.cleanup) }) : null, state.matchedStores.length ? [h('h4', { children: text('cookie_probe_copies') }), h('ul', { children: state.matchedStores.map(row => h('li', { children: row.storage + ': ' + row.count })) })] : null] });
  }
  function CookieProbePanel({ probe, cookies }) {
    useLocale();
    const [selected, setSelected] = useState('');
    const entries = (cookies.state?.entries ?? []).map((entry, index) => ({ entry, index, handle: cookies.handles?.[index] })).filter(row => row.entry.tracking && !row.entry.httpOnly && !row.entry.session && typeof row.handle === 'string');
    const chosen = entries.find(row => row.handle === selected);
    const running = ['preparing', 'watching'].includes(probe.state?.status);
    return h('section', { class: 'advanced-inspector cookie-probe', 'data-cookie-probe-panel': true, children: [
      h('h3', { children: text('cookie_probe_title') }),
      h('p', { children: text('cookie_probe_action_description') }),
      h('label', { class: 'cookie-probe-select', children: [h('span', { children: text('cookie_probe_select') }), h('select', { value: chosen ? selected : '', disabled: running || probe.pending || cookies.busy, onChange: event => setSelected(event.currentTarget.value), children: [h('option', { value: '', children: text('cookie_probe_select') }), ...entries.map(row => h('option', { value: row.handle, key: row.index, children: row.entry.name + ' · ' + row.entry.domain }))] })] }),
      h('div', { class: 'advanced-actions', children: [h('button', { type: 'button', class: 'button', 'data-cookie-probe-start': true, disabled: !chosen || running || probe.pending || cookies.busy || !probe.eligible, onClick: async () => { cookies.hideValue(); await probe.start(chosen.handle); }, children: text('cookie_probe_start') }), running ? h('button', { type: 'button', class: 'button', 'data-cookie-probe-cancel': true, disabled: probe.pending, onClick: probe.cancel, children: text('cookie_probe_cancel') }) : null] }),
      h(CookieProbeResult, { state: probe.state })
    ] });
  }
  function ProAdvancedSnapshot({ page }) {
    useLocale();
    const beacons = page.beacons === undefined ? [] : readBeaconDocuments(page.beacons), background = page.backgroundActivity === undefined ? [] : readBackgroundDocuments(page.backgroundActivity), probes = page.cookieProbes === undefined ? [] : readCookieProbeDocuments(page.cookieProbes);
    if (beacons === null || background === null || probes === null) return null;
    const documentName = (state, index) => page.reports?.find(report => report.documentKey === state.documentKey)?.host || text('social_document', [String(index + 1)]);
    const table = (columns, rows, properties = {}) => h('table', { class: 'pro-data-table', ...properties, children: [
      h('thead', { children: h('tr', { children: columns.map(key => h('th', { scope: 'col', children: text(key) })) }) }), h('tbody', { children: rows })
    ] });
    const cell = children => h('td', { children });
    const line = (key, value) => h('div', { class: 'pro-table-fact', children: [h('span', { class: 'small', children: text(key) + ': ' }), value] });
    const evidence = row => h('span', { class: 'small', children: text('evidence_' + normalized(row.evidenceSource)) });
    const limited = beacons.some(state => state.truncated) || background.some(state => state.truncated || state.inventory.truncated);
    const beaconRows = beacons.flatMap((state, documentIndex) => [...state.rows, ...state.scriptCalls].map((row, index) => h('tr', {
      key: state.documentKey + ':' + index, 'data-beacon-row': index, 'data-beacon-source': row.evidenceSource, children: [
        cell([h(CompanyLabel, { name: serviceNames[row.service], identity: row.service }), h('code', { dir: 'ltr', children: row.destinationHost })]),
        cell([h('strong', { children: row.events.length ? row.events.map(eventText).join(' · ') : '—' }),
          ...row.money.map((item, moneyIndex) => h('div', { key: moneyIndex, children: [text('beacon_money_' + normalized(item.purpose)), ': ', item.value, item.currency ? ' ' + item.currency : '', item.event !== 'unknown' ? ' · ' + eventText(item.event) : ''] }))]),
        cell([
          ...identifierKeys.filter(key => !['absent', 'unknown'].includes(row.identifiers[key])).map(key => line('beacon_id_' + key, text('advanced_presence_' + row.identifiers[key]))),
          ...consentKeys.filter(key => !['absent', 'unknown'].includes(row.consent[key])).map(key => line('beacon_consent_' + key, text('advanced_presence_' + row.consent[key]))),
          row.parameterNames.length ? line('beacon_fields', row.parameterNames.map(key => text('beacon_field_' + normalized(key))).join(' · ')) : '—',
          row.decodeStatus !== 'complete' ? line('beacon_decode', text('beacon_decode_' + normalized(row.decodeStatus))) : null
        ]),
        cell([row.script ? resource(row.script) : '—', line('third_party_document', documentName(state, documentIndex)), row.initiatorHost ? line('third_party_initiator', h('code', { dir: 'ltr', children: row.initiatorHost })) : null,
          h('span', { class: 'small', children: text('attribution_' + normalized(row.attributionConfidence)) })]),
        cell([h('code', { dir: 'ltr', children: row.method + ' · ' + row.requestType }), evidence(row),
          row.evidenceSource === 'browser-network' ? [line('third_party_status', row.statusCodes.join(', ') || '—'), line('third_party_completed', row.completedCount), line('third_party_failed', row.failedCount), row.redirectCount ? line('third_party_redirects', row.redirectCount) : null] : null]),
        cell(text(row.evidenceSource === 'browser-network' ? 'social_browser_request_count' : row.evidenceSource === 'page-hook' ? 'social_page_action_count' : 'beacon_request_count', [String(row.count)]) + (row.evidenceSource === 'page-dom' ? ': ' + row.count : ''))
      ]
    })));
    const backgroundRows = background.flatMap((state, documentIndex) => state.rows.map((row, index) => h('tr', { key: state.documentKey + ':' + index, 'data-background-row': index, children: [
      cell(h('code', { children: row.operation })), cell(documentName(state, documentIndex)), cell(resource(row.script)), cell(row.worker ? resource(row.worker) : '—'),
      cell([text('phase_' + normalized(row.phase)), evidence(row)]), cell(row.count)
    ] })));
    const inspected = background.filter(state => state.inventory.status === 'available' &&
      (state.inventory.registrations.length || state.inventory.registrationCount > 0 || state.inventory.pushSubscriptionCount > 0 || state.inventory.syncTagCount > 0 || state.inventory.periodicTagCount > 0));
    const inventoryRows = inspected.flatMap(state => {
      const inventory = state.inventory, documentIndex = background.indexOf(state);
      return [['serviceWorker', 'Service Worker', inventory.registrationCount, null], ['push', 'Web Push', inventory.pushSubscriptionCount, 'push'],
        ['sync', 'Background Sync', inventory.syncTagCount, 'sync'], ['periodicSync', 'Periodic Background Sync', inventory.periodicTagCount, 'periodicSync']].map(([key, label, count, permission]) => h('tr', {
          key: state.documentKey + ':' + key, 'data-background-capability': key, children: [cell(documentName(state, documentIndex)), cell(label), cell(text(inventory.supported[key] ? 'advanced_supported' : 'advanced_unsupported')),
            cell(permission ? text('advanced_presence_' + inventory.permissions[permission]) : '—'), cell(count ?? '—')]
        }));
    });
    const registrationRows = inspected.flatMap(state => state.inventory.registrations.map((row, index) => h('tr', { key: state.documentKey + ':' + index, children: [
      cell(documentName(state, background.indexOf(state))), cell(resource(row.scope)), cell(resource(row.script)), cell(text('background_state_' + row.state)),
      cell(row.pushSubscribed === null ? '—' : text(row.pushSubscribed ? 'cookie_yes' : 'cookie_no')), cell(row.syncTagCount ?? '—'), cell(row.periodicTagCount ?? '—')
    ] })));
    const probeRows = probes.filter(state => state.status !== 'idle').map((state, index) => h('tr', { key: state.documentKey, 'data-cookie-probe-result': state.result, children: [
      cell([h('code', { children: state.cookieName }), h('div', { children: state.domain }), state.owner ? h(CompanyLabel, { name: state.owner, identity: state.owner }) : null]),
      cell([text(['preparing', 'watching'].includes(state.status) ? 'cookie_probe_watching' : 'cookie_probe_result_' + normalized(state.result)),
        state.reason !== 'none' ? h('div', { children: text('cookie_probe_reason_' + normalized(state.reason)) }) : null,
        state.cleanup !== 'none' && state.cleanup !== 'not-needed' ? h('div', { children: text('cookie_probe_cleanup_' + state.cleanup) }) : null]),
      cell(state.matchedStores.length ? state.matchedStores.map(row => h('div', { children: row.storage + ': ' + row.count })) : '—'),
      cell(documentName(state, index))
    ] }));
    if (!beaconRows.length && !backgroundRows.length && !inventoryRows.length && !registrationRows.length && !probeRows.length && !limited) return null;
    return h('div', { class: 'pro-advanced', 'data-pro-advanced': true, children: [
      beaconRows.length ? h('section', { 'data-pro-beacons': true, children: [h('h4', { children: text('beacon_title') }), table(['social_service_column', 'beacon_field_event', 'beacon_fields', 'beacon_script', 'beacon_transport', 'beacon_request_count'], beaconRows, { 'data-beacon-rows': true })] }) : null,
      backgroundRows.length || inventoryRows.length ? h('section', { 'data-pro-background': true, children: [h('h4', { children: text('background_title') }),
        inventoryRows.length ? table(['third_party_document', 'background_title', 'background_api', 'background_permission', 'background_tasks'], inventoryRows) : null,
        registrationRows.length ? table(['third_party_document', 'background_scope', 'background_worker', 'background_state', 'background_subscriptions', 'background_sync', 'background_periodic_sync'], registrationRows, { 'data-background-registrations': true }) : null,
        backgroundRows.length ? table(['background_calls', 'third_party_document', 'beacon_script', 'background_worker', 'detail_phases', 'beacon_request_count'], backgroundRows) : null
      ] }) : null,
      probeRows.length ? h('section', { 'data-pro-cookie-probes': true, children: [h('h4', { children: text('cookie_probe_title') }), table(['cookie_report_identity', 'cookie_probe_title', 'cookie_probe_copies', 'third_party_document'], probeRows)] }) : null,
      limited ? h('p', { class: 'small report-muted', 'data-pro-advanced-truncated': true, children: text('advanced_truncated') }) : null
    ] });
  }
  return { useBeacons, useBackgroundActivity, useCookieProbe, BeaconRows, BeaconPanel, BackgroundRows, BackgroundPanel, CookieProbePanel, CookieProbeResult, ProAdvancedSnapshot };
}
