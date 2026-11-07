// ADR-070/071/103/107 round 5: the Add/Edit sheet and the list-import dialog of the Proxy manager. Both are native modal dialogs
// (focus is trapped, the page behind is inert, Escape asks to close and focus returns to the opener). Secrets stay where they were:
// masked fields in this page's memory only, erased by the owner of the state in proxy-ui.js; nothing here stores, logs or renders a
// credential, and every preview shows type and endpoint only.
import { proxyEndpointLabel, PROXY_TYPES, PROXY_DIRECT_TYPES, PROXY_LIMITS, PROXY_LIST_ORDERS, PROXY_LIST_TYPES } from './proxy-shared.js';
import { TYPE_LABELS } from './proxy-list-ui.js';

const MAX_CONFIG = PROXY_LIMITS.openVpnBytes;
const BULK_GLYPHS = Object.freeze({ ready: 'pass', saved: 'pass', warning: 'pending', failed: 'fail', error: 'fail', duplicate: 'unknown' });
const ERROR_KEYS = Object.freeze({ name: 'err_name', host: 'err_host', port: 'err_port', uri: 'err_uri', config: 'err_config' });

export function createProxySheetUi({ h, t, c, icons, list }) {
  const { icon, badgeIcon } = icons, { button, iconButton } = list;

  // ---- Fields --------------------------------------------------------------------------------------------------------------------
  // A labelled input with its reason. The reason (a fixed sentence) is tied to the input with aria-describedby once it shows.
  function field(m, key, label, options = {}) {
    const { wrap = null, ...inputOptions } = options, error = m.showErrors ? m.errors[key] : null, errorId = 'pm-error-' + key, inputId = 'pm-field-' + key;
    const input = h('input', { id: inputId, type: 'text', class: 'pm-input', value: m.editor?.[key] ?? '', disabled: m.busy, autoComplete: 'off', spellcheck: false, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? errorId : undefined, 'data-proxy-field': key, onInput: event => m.change(key, event.currentTarget.value), ...inputOptions });
    return h('div', { class: 'pm-field' + (error ? ' has-error' : '') + (options.class ? ' ' + options.class : ''), children: [
      h('label', { class: 'pm-field-label', for: inputId, children: [h('span', { children: label }), wrap ? null : input] }),
      wrap ? h('div', { class: 'pm-input-wrap', children: [input, wrap] }) : null,
      error ? h('p', { class: 'pm-error', id: errorId, role: 'alert', 'data-proxy-field-error': key, children: [badgeIcon('fail'), h('span', { children: t(ERROR_KEYS[key]) })] }) : null,
    ] });
  }
  // A masked field with a show/hide toggle. The toggle only switches the input type; it is never remembered.
  function secretField(m, key, label, options = {}) {
    const shown = Boolean(m.reveal[key]);
    return field(m, key, label, { ...options, type: shown ? 'text' : 'password', wrap: h('button', { type: 'button', class: 'pm-reveal', 'aria-pressed': shown, 'aria-label': t('show_password'), title: t('show_password'), disabled: m.busy, 'data-proxy-reveal': key, onClick: () => m.toggleReveal(key), children: icon(shown ? 'eyeOff' : 'eye', 16) }) });
  }
  function typeSegments(m, replacing) {
    return h('div', { class: 'pm-fieldset', children: [
      h('span', { class: 'pm-field-label', id: 'pm-type-label', children: c('field_type') }),
      h('div', { class: 'pm-types', role: 'radiogroup', 'aria-labelledby': 'pm-type-label', 'data-proxy-type': m.editor.type, children: PROXY_TYPES.map(type => h('button', { type: 'button', role: 'radio', 'aria-checked': m.editor.type === type, tabIndex: m.editor.type === type ? 0 : -1, disabled: m.busy || replacing, class: 'pm-type-btn pm-type--' + type + (m.editor.type === type ? ' is-on' : ''), 'data-proxy-type-option': type, onClick: () => m.switchType(type), onKeyDown: event => m.onTypeKey(event, type), children: [icon(type, 18), h('span', { children: TYPE_LABELS[type] })] })) }),
    ] });
  }

  // ---- Add / Edit sheet -----------------------------------------------------------------------------------------------------------------
  function editorSheet(m) {
    const editor = m.editor;
    if (!editor) return null;
    const replacing = Boolean(editor.id), direct = PROXY_DIRECT_TYPES.includes(editor.type);
    return h('dialog', { class: 'pm-sheet pm-sheet--editor pm-type--' + editor.type, ref: m.editorDialog, 'aria-labelledby': 'proxy-editor-title', 'data-proxy-editor': editor.type, onCancel: event => { event.preventDefault?.(); m.cancelEditor(); }, children: [
      h('header', { class: 'pm-sheet-head', children: [
        h('span', { class: 'pm-avatar pm-avatar--lg pm-type--' + editor.type, 'aria-hidden': 'true', children: icon(editor.type, 22) }),
        h('div', { class: 'pm-sheet-titles', children: [h('h3', { id: 'proxy-editor-title', class: 'pm-sheet-title', children: replacing ? c('action_edit') + ': ' + (m.originalName ?? editor.name) : t('new_profile') }), h('span', { class: 'pm-sheet-sub', children: TYPE_LABELS[editor.type] })] }),
        iconButton(t('close'), { disabled: m.busy, 'data-proxy-sheet-close': true, onClick: () => m.cancelEditor() }, 'close'),
      ] }),
      h('div', { class: 'pm-sheet-body', children: [
        typeSegments(m, replacing),
        !replacing ? h('div', { class: 'pm-paste', children: [
          h('div', { class: 'pm-paste-row', children: [
            h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('smart_paste') }), h('input', { type: 'password', class: 'pm-input', ref: m.pasteRef, value: m.paste, disabled: m.busy, dir: 'ltr', autoComplete: 'new-password', maxLength: MAX_CONFIG, placeholder: '203.0.113.10:1080:user:password', 'aria-describedby': m.paste ? 'proxy-paste-preview' : undefined, 'data-proxy-paste': true, onInput: event => m.setPaste(event.currentTarget.value), onKeyDown: event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault?.(); m.parsePasted(); } } })] }),
            button(t('parse'), { disabled: m.busy || !m.paste, 'data-proxy-parse': true, onClick: () => m.parsePasted() }),
          ] }),
          m.pastePreview(),
        ] }) : null,
        m.detailNotes(),
        field(m, 'name', c('field_name'), { ref: m.editorRef, maxLength: 96 }),
        direct ? h('div', { class: 'pm-config', children: [
          h('div', { class: 'pm-row2', children: [field(m, 'host', t('host'), { dir: 'ltr', maxLength: 253, class: 'pm-field--grow' }), field(m, 'port', t('port'), { inputMode: 'numeric', dir: 'ltr', maxLength: 5, class: 'pm-field--port' })] }),
          h('div', { class: 'pm-row2 pm-session-field', children: [field(m, 'username', t('username'), { maxLength: 255, class: 'pm-field--grow' }), button(t('random_session'), { class: 'button pm-session-button', disabled: m.busy || !m.editor[m.sessionTarget] || !m.sessionValid, title: t('random_session') + ': ' + (m.sessionTarget === 'password' ? t('password') : t('username')), 'data-proxy-random-session': true, onClick: () => m.randomSession() }, 'dice')] }),
          secretField(m, 'password', t('password'), { maxLength: 255, autoComplete: 'new-password' }),
          m.sessionView(),
        ] }) : editor.type === 'vless' ? secretField(m, 'uri', t('uri'), { dir: 'ltr', maxLength: 16384, autoComplete: 'new-password' })
          : h('div', { class: 'pm-config', children: [
            h('div', { class: 'pm-file', children: [button(t('choose_file'), { disabled: m.busy, 'data-proxy-file-pick': true, onClick: () => m.fileInput.current?.click?.() }, 'file'), h('input', { type: 'file', class: 'pm-file-input', accept: '.ovpn,text/plain', ref: m.fileInput, disabled: m.busy, tabIndex: -1, 'data-proxy-file': true, onChange: m.fileChange, 'aria-label': t('choose_file') })] }),
            h('div', { class: 'pm-field' + (m.showErrors && m.errors.config ? ' has-error' : ''), children: [h('label', { class: 'pm-field-label', children: [h('span', { children: t('configuration') }), h('textarea', { class: 'pm-input pm-textarea', value: editor.config, disabled: m.busy, dir: 'ltr', spellcheck: false, autoComplete: 'off', maxLength: MAX_CONFIG, rows: 8, 'aria-invalid': m.showErrors && m.errors.config ? 'true' : undefined, 'aria-describedby': m.showErrors && m.errors.config ? 'pm-error-config' : undefined, 'data-proxy-field': 'config', onInput: event => m.change('config', event.currentTarget.value) })] }), m.showErrors && m.errors.config ? h('p', { class: 'pm-error', id: 'pm-error-config', role: 'alert', 'data-proxy-field-error': 'config', children: [badgeIcon('fail'), h('span', { children: t('err_config') })] }) : null] }),
            h('div', { class: 'pm-row2', children: [field(m, 'username', t('username'), { maxLength: 255, class: 'pm-field--grow' }), secretField(m, 'password', t('password'), { maxLength: 255, autoComplete: 'new-password', class: 'pm-field--grow' })] }),
          ] }),
        m.countryBox(),
        replacing ? h('p', { class: 'pm-note', children: t('replace_secret') }) : null,
        m.duplicateNote ? h('p', { class: 'pm-note pm-note--info', 'data-proxy-duplicate-note': true, children: [icon('info', 15), h('span', { children: m.duplicateNote })] }) : null,
        m.error ? h('p', { class: 'pm-error pm-error--block', role: 'alert', 'data-proxy-error': true, children: [badgeIcon('fail'), h('span', { children: m.error })] }) : null,
        m.diagnosticNode,
      ] }),
      h('footer', { class: 'pm-sheet-foot', children: [button(c('cancel'), { disabled: m.busy, 'data-proxy-cancel': true, onClick: () => m.cancelEditor() }), button(c('save'), { class: 'button button--primary', disabled: m.busy, 'data-proxy-save-profile': true, onClick: () => m.saveProfile() })] }),
    ] });
  }

  // ---- List import dialog ---------------------------------------------------------------------------------------------------------------
  function bulkDialog(m) {
    const bulk = m.bulk;
    if (!bulk) return null;
    const preview = bulk.step === 'preview', room = m.bulkRoom(), saving = bulk.saving;
    const ready = bulk.entries.filter(entry => entry.profile), duplicates = bulk.entries.filter(entry => entry.reason === 'duplicate').length, errors = bulk.entries.filter(entry => entry.reason && entry.reason !== 'duplicate').length;
    const savedCount = Object.values(bulk.results).filter(result => result.id).length, selectable = ready.filter(entry => !bulk.results[entry.line]?.id), pending = bulk.selected.length;
    const allSelected = selectable.length > 0 && pending >= Math.min(room, selectable.length);
    const dialogError = m.error ? h('p', { class: 'pm-error pm-error--block', role: 'alert', 'data-proxy-bulk-error': true, children: [badgeIcon('fail'), h('span', { children: m.error })] }) : null;
    const header = label => h('th', { scope: 'col', children: label });
    const stat = (label, value, kind, properties = {}) => h('span', { class: 'pm-stat pm-stat--' + kind, ...properties, children: [h('span', { class: 'pm-stat-label', children: label }), h('strong', { class: 'pm-num', children: String(value) })] });
    const row = entry => {
      const result = bulk.results[entry.line], saved = Boolean(result?.id), selected = bulk.selected.includes(entry.line);
      const state = entry.reason ? (entry.reason === 'duplicate' ? 'duplicate' : 'error') : saved ? 'saved' : result?.code ? 'failed' : entry.warning ? 'warning' : 'ready';
      const status = entry.reason === 'duplicate' ? m.reasonText('duplicate') + ' · ' + t('bulk_line') + ' ' + entry.duplicateOf : entry.reason ? m.reasonText(entry.reason) : saved ? c('saved') : result?.code ? m.diagnosticText(result.code, entry.profile?.type) : entry.warning === 'saved-endpoint' ? t('bulk_saved_endpoint') : t('bulk_ready');
      return h('tr', { class: 'pm-bulk-row pm-bulk-row--' + state, 'data-proxy-bulk-line': entry.line, 'data-state': state, children: [
        h('td', { class: 'pm-bulk-check', children: entry.profile ? h('input', { type: 'checkbox', class: 'pm-check-input', checked: saved || selected, disabled: m.busy || saved || !selected && pending >= room, 'aria-label': t('bulk_line') + ' ' + entry.line + ': ' + entry.name, 'data-proxy-bulk-select': entry.line, onChange: event => m.toggleBulk(entry.line, event.currentTarget.checked) }) : null }),
        h('td', { class: 'pm-bulk-number', 'data-label': t('bulk_line'), children: String(entry.line) }),
        h('td', { class: entry.profile ? 'pm-bulk-name' : 'pm-bulk-empty', 'data-label': c('field_name'), children: entry.name ?? '—' }),
        h('td', { class: entry.profile ? undefined : 'pm-bulk-empty', 'data-label': c('field_type'), children: entry.profile ? list.typePill(entry.profile.type) : '—' }),
        h('td', { class: entry.profile ? undefined : 'pm-bulk-empty', 'data-label': t('host'), children: entry.endpoint ? h('span', { class: 'pm-mono', dir: 'ltr', children: proxyEndpointLabel(entry.endpoint.host, entry.endpoint.port) }) : '—' }),
        h('td', { class: entry.profile ? undefined : 'pm-bulk-empty', 'data-label': t('username'), children: entry.profile?.username ? h('span', { class: 'pm-mono', dir: 'ltr', children: entry.profile.username }) : '—' }),
        h('td', { 'data-label': c('field_state'), children: h('span', { class: 'pm-bulk-status pm-bulk-status--' + state, 'data-proxy-bulk-status': entry.line, children: [badgeIcon(BULK_GLYPHS[state]), h('span', { children: status })] }) }),
      ] });
    };
    return h('dialog', { class: 'pm-sheet pm-sheet--bulk', ref: m.bulkDialog, 'aria-labelledby': 'proxy-bulk-title', 'aria-describedby': 'proxy-bulk-detail', 'data-proxy-bulk': bulk.step, onCancel: event => { event.preventDefault?.(); m.cancelBulk(); }, children: [
      h('header', { class: 'pm-sheet-head', children: [
        h('span', { class: 'pm-avatar pm-avatar--lg', 'aria-hidden': 'true', children: icon('import', 22) }),
        h('div', { class: 'pm-sheet-titles', children: [h('h3', { id: 'proxy-bulk-title', class: 'pm-sheet-title', children: t('bulk_import') }), h('span', { class: 'pm-sheet-sub', children: preview ? t('bulk_recognized') + ': ' + ready.length : t('bulk_text') })] }),
        iconButton(t('close'), { 'data-proxy-bulk-close': true, onClick: () => m.cancelBulk() }, 'close'),
      ] }),
      h('div', { class: 'pm-sheet-body', children: preview ? [
        h('p', { id: 'proxy-bulk-detail', class: 'pm-stats', role: 'status', tabIndex: -1, 'data-proxy-bulk-summary': true, children: [
          stat(t('bulk_recognized'), ready.length, 'ok'), stat(t('bulk_errors'), errors, errors ? 'err' : 'off'), stat(t('bulk_duplicates'), duplicates, duplicates ? 'warn' : 'off'),
          stat(t('bulk_room'), room + ' / ' + PROXY_LIMITS.profiles, 'info', { 'data-proxy-bulk-room': room }),
        ] }),
        selectable.length > room ? h('p', { class: 'pm-note pm-note--warn', 'data-proxy-bulk-limit': true, children: [icon('warning', 15), h('span', { children: t('bulk_limit') })] }) : null,
        saving ? h('div', { class: 'pm-progress', role: 'status', 'data-proxy-bulk-progress': true, children: [icons.spinner(14), h('span', { children: t('bulk_saving') + ' ' + (saving.index + 1) + ' / ' + saving.total })] }) : null,
        bulk.entries.length ? h('div', { class: 'pm-bulk-wrap', children: h('table', { class: 'pm-bulk-table', 'data-proxy-bulk-table': true, children: [h('thead', { children: h('tr', { children: [h('th', { scope: 'col', class: 'pm-bulk-check', children: h('label', { class: 'pm-bulk-all', children: [h('input', { type: 'checkbox', class: 'pm-check-input', checked: allSelected, disabled: m.busy || !selectable.length || room === 0, 'aria-label': t('bulk_select_all'), 'data-proxy-bulk-all': true, onChange: event => m.selectAllBulk(event.currentTarget.checked) }), h('span', { class: 'pm-bulk-all-label', 'aria-hidden': 'true', children: t('bulk_select_all') })] }) }), header(t('bulk_line')), header(c('field_name')), header(c('field_type')), header(t('host')), header(t('username')), header(c('field_state'))] }) }), h('tbody', { children: bulk.entries.map(row) })] }) }) : h('p', { class: 'pm-muted', children: c('empty') }),
        dialogError,
      ] : [
        h('p', { id: 'proxy-bulk-detail', class: 'pm-note', children: t('bulk_detail') }),
        h('div', { class: 'pm-row2', children: [
          h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('bulk_format') }), h('select', { class: 'pm-input', value: bulk.order, disabled: m.busy, 'data-proxy-bulk-format': true, onChange: event => m.changeBulk({ order: PROXY_LIST_ORDERS.includes(event.currentTarget.value) ? event.currentTarget.value : 'host-first' }), children: PROXY_LIST_ORDERS.map(order => h('option', { value: order, children: t(order === 'host-first' ? 'bulk_format_host_first' : 'bulk_format_login_first') })) })] }),
          h('label', { class: 'pm-field pm-field--grow', children: [h('span', { class: 'pm-field-label', children: t('bulk_default_type') }), h('select', { class: 'pm-input', value: bulk.defaultType, disabled: m.busy, 'data-proxy-bulk-type': true, onChange: event => m.changeBulk({ defaultType: PROXY_LIST_TYPES.includes(event.currentTarget.value) ? event.currentTarget.value : 'socks5' }), children: PROXY_LIST_TYPES.map(type => h('option', { value: type, children: TYPE_LABELS[type] })) })] }),
        ] }),
        h('label', { class: 'pm-field', children: [h('span', { class: 'pm-field-label', children: t('bulk_text') }), h('textarea', { class: 'pm-input pm-textarea', value: bulk.text, rows: 10, dir: 'ltr', spellcheck: false, autoComplete: 'off', autofocus: true, maxLength: PROXY_LIMITS.configBytes, placeholder: t('bulk_placeholder'), disabled: m.busy, 'data-proxy-bulk-text': true, onInput: event => m.changeBulk({ text: event.currentTarget.value }) })] }),
        dialogError,
      ] }),
      h('footer', { class: 'pm-sheet-foot', children: preview ? [button(t('bulk_back'), { disabled: m.busy || savedCount > 0, 'data-proxy-bulk-back': true, onClick: () => m.backBulk() }), button(c('cancel'), { 'data-proxy-bulk-cancel': true, onClick: () => m.cancelBulk() }), button(t('bulk_save') + ' (' + pending + ')', { class: 'button button--primary', disabled: m.busy || !pending || pending > room, 'data-proxy-bulk-save': true, onClick: () => m.saveBulk() }, 'plus')]
        : [button(c('cancel'), { 'data-proxy-bulk-cancel': true, onClick: () => m.cancelBulk() }), button(t('parse'), { class: 'button button--primary', disabled: m.busy || !bulk.text.trim(), 'data-proxy-bulk-parse': true, onClick: () => m.parseBulk() })] }),
    ] });
  }

  // The notes under the imported rows after a save: saved this visit, check them, delete the failed ones after one confirmation.
  function importedBar(m) {
    const ids = (m.imported?.ids ?? []).filter(id => m.profiles.some(profile => profile.id === id));
    if (!ids.length) return null;
    const failed = ids.filter(id => m.checks[id]?.diagnostic?.state === 'fail' && !(m.configuration?.enabled && m.configuration.selectedId === id)), passed = ids.filter(id => m.checks[id]?.diagnostic?.state === 'pass');
    return h('div', { class: 'pm-imported', role: 'group', 'aria-label': t('bulk_imported'), 'data-proxy-imported': String(ids.length), children: [
      h('p', { class: 'pm-imported-text', children: t('bulk_imported') + ': ' + ids.length + (passed.length + failed.length ? ' · ' + t('check_pass') + ': ' + passed.length + ' · ' + t('check_fail') + ': ' + failed.length : '') }),
      m.imported.confirm ? h('div', { class: 'pm-imported-actions', role: 'group', 'aria-label': t('bulk_delete_failed'), 'data-proxy-imported-confirm': true, children: [h('span', { children: t('bulk_delete_confirm') + ' ' + failed.length }), button(c('cancel'), { disabled: m.busy, 'data-proxy-imported-keep': true, onClick: () => m.keepImported() }), button(c('action_remove'), { class: 'button pm-danger', disabled: m.busy || !failed.length, 'data-proxy-imported-delete': true, onClick: () => m.deleteFailedImported() }, 'delete')] })
        : h('div', { class: 'pm-imported-actions', children: [button(t('bulk_check_imported'), { disabled: m.busy, 'data-proxy-check-imported': true, onClick: () => m.checkImported() }, 'check'), button(t('bulk_delete_failed') + (failed.length ? ' (' + failed.length + ')' : ''), { disabled: m.busy || !failed.length, 'data-proxy-delete-failed': true, onClick: () => m.askDeleteFailedImported() }, 'delete'), iconButton(t('close'), { disabled: m.busy, 'data-proxy-imported-close': true, onClick: () => m.closeImported() }, 'close')] }),
    ] });
  }
  return { editorSheet, bulkDialog, importedBar, field };
}
