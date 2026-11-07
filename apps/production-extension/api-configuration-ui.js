// ADR-048: typed, local API values and complete configuration transfer.
import {
  API_CONFIG_CATALOG, API_CUSTOM_ONLY_IDS, validateApiValue, validateApiConfiguration,
  importApiConfiguration, exportApiConfiguration, nextApiValueId,
  updateApiConfiguration, apiConfigurationWarnings, API_CONFIGURATION_MAX_BYTES
} from './api-configuration.js';
import { createWebRtcConfigurationUi, formatWebRtcProfile, WEBRTC_PROFILE_DEFAULT, webRtcText, webRtcPolicyLabelKey } from './webrtc-configuration-ui.js';
import { createMediaCodecConfigurationUi, readMediaCodecInput, MEDIA_CODEC_START } from './media-codec-configuration-ui.js';
import { createApiObservedUsageUi, observedApiUsage, observedApiClass, observedApiAttributes } from './api-observed-usage-ui.js';
import { createWorkspaceControlsUi } from './workspace-controls-ui.js';
import { redesignLabels } from './redesign-labels.js';
import { apiGuardLabels } from './api-guard-labels.js';

const STRINGS = {
  en: {
    choose: 'Choose a value', search: 'Search values', create: 'Create New Value', edit: 'Edit value', delete: 'Delete value',
    presets: 'Preset values', own: 'Your values', noMatches: 'No matching values', label: 'Name', value: 'Value',
    save: 'Save', cancel: 'Cancel', valueType: 'Value type', actual: 'Value', null: 'null', undefined: 'undefined',
    unset: 'Not selected', empty: 'Empty string ("")', saved: 'Value saved', deleted: 'Value deleted',
    import: 'Import JSON', export: 'Export JSON', previewImport: 'Import preview', previewExport: 'Export preview',
    apply: 'Apply import', download: 'Download JSON', undo: 'Undo import', imported: 'Configuration imported', undone: 'Import undone',
    changed: 'Changed APIs', changedSites: 'Changed sites', all: 'All APIs', noChanges: 'No changes', migrated: 'Previous configuration format converted',
    error: 'Unable to save the configuration. Refresh and try again.', stale: 'Settings changed in another window. Refresh before saving.',
    tooLarge: 'The configuration file is too large.', invalidJson: 'Invalid JSON file.', nameRequired: 'Enter a value name.',
    invalidNumber: 'Enter a finite number.', invalidValue: 'Invalid value.', unsupported: 'Custom values are unavailable for this API.',
    confirmDelete: 'Delete this saved value?', confirm: 'Delete', format: 'Format version',
    selected: 'Value selected', showValue: 'Current value', hints: { string: 'Text; an empty string is a separate value.', integer: 'Whole number.', number: 'Finite number.', boolean: 'Boolean: true or false.', object: 'JSON object.', array: 'JSON array.' },
    title: 'Browser API configuration', master: 'API management', loading: 'Loading configuration…', saveConfig: 'Save configuration', saveReload: 'Save and reload', refresh: 'Refresh', discard: 'Cancel changes', reset: 'Reset API modes',
    scope: 'Scope', global: 'All sites', site: 'Site', addSite: 'Add site', removeSite: 'Remove site', siteOff: 'Disable API management on this site', noHost: 'Choose a site', hostError: 'Enter a valid exact host, for example example.com.',
    searchApis: 'Search APIs', configured: 'Configured only', allGroups: 'All categories', customOnly: 'Custom supported', draft: 'Unsaved changes', configSaved: 'Configuration saved', inactive: 'API management is off', active: 'API management is on',
    activationFailed: 'Settings saved, but API overrides were not applied. Check Custom access and refresh before reloading the site.',
    reload: 'Reload the site to apply these changes to existing documents.', preset: 'Protection preset', limited: 'Limited', strict: 'Strict', custom: 'Custom', noApis: 'No matching APIs', inherited: 'Inherited',
    earlyPermission: 'Enable user script access to use Custom values from the first page script.', earlyToggle: 'Enable Allow User Scripts in the extension’s browser settings, then restart the browser and reopen this editor.', earlyUnsupported: 'This browser does not provide the user script access required for Custom values.', earlyGrant: 'Enable Custom access', earlySettings: 'Open browser settings', earlyRefresh: 'Refresh access', earlyDenied: 'User script access was not granted.',
    groups: { graphics: 'Graphics and screen', media: 'Audio and media', device: 'Device parameters', hardware: 'Connected devices', background: 'Background', browser: 'Browser', system: 'Operating system', ai: 'AI', storage: 'Storage', network: 'Network', identity: 'Identity' },
  },
  ru: {
    choose: 'Выберите значение', search: 'Поиск значений', create: 'Create New Value', edit: 'Изменить значение', delete: 'Удалить значение',
    presets: 'Предустановленные значения', own: 'Ваши значения', noMatches: 'Нет подходящих значений', label: 'Название', value: 'Значение',
    save: 'Save', cancel: 'Cancel', valueType: 'Тип значения', actual: 'Значение', null: 'null', undefined: 'undefined',
    unset: 'Не выбрано', empty: 'Пустая строка ("")', saved: 'Значение сохранено', deleted: 'Значение удалено',
    import: 'Import JSON', export: 'Export JSON', previewImport: 'Предпросмотр импорта', previewExport: 'Предпросмотр экспорта',
    apply: 'Применить импорт', download: 'Скачать JSON', undo: 'Отменить импорт', imported: 'Конфигурация импортирована', undone: 'Импорт отменён',
    changed: 'Изменённых API', changedSites: 'Изменённых сайтов', all: 'Всего API', noChanges: 'Изменений нет', migrated: 'Предыдущий формат конфигурации преобразован',
    error: 'Не удалось сохранить конфигурацию. Обновите настройки и повторите попытку.', stale: 'Настройки изменились в другом окне. Обновите их перед сохранением.',
    tooLarge: 'Файл конфигурации слишком большой.', invalidJson: 'Некорректный JSON-файл.', nameRequired: 'Введите название значения.',
    invalidNumber: 'Введите конечное число.', invalidValue: 'Некорректное значение.', unsupported: 'Для этого API пользовательские значения недоступны.',
    confirmDelete: 'Удалить сохранённое значение?', confirm: 'Удалить', format: 'Версия формата',
    selected: 'Значение выбрано', showValue: 'Текущее значение', hints: { string: 'Текст; пустая строка — отдельное значение.', integer: 'Целое число.', number: 'Конечное число.', boolean: 'Логическое значение: true или false.', object: 'JSON-объект.', array: 'JSON-массив.' },
    title: 'Конфигурация браузерных API', master: 'Управление API', loading: 'Загрузка конфигурации…', saveConfig: 'Сохранить конфигурацию', saveReload: 'Сохранить и перезагрузить', refresh: 'Обновить', discard: 'Отменить изменения', reset: 'Сбросить режимы API',
    scope: 'Область', global: 'Все сайты', site: 'Сайт', addSite: 'Добавить сайт', removeSite: 'Удалить сайт', siteOff: 'Отключить управление API на этом сайте', noHost: 'Выберите сайт', hostError: 'Введите корректный хост, например example.com.',
    searchApis: 'Поиск API', configured: 'Только настроенные', allGroups: 'Все категории', customOnly: 'Поддерживают своё значение', draft: 'Есть несохранённые изменения', configSaved: 'Конфигурация сохранена', inactive: 'Управление API выключено', active: 'Управление API включено',
    activationFailed: 'Настройки сохранены, но переопределения API не применены. Проверьте доступ Custom и обновите настройки перед перезагрузкой сайта.',
    reload: 'Перезагрузите сайт, чтобы применить изменения к уже открытым документам.', preset: 'Профиль защиты', limited: 'Ограниченный', strict: 'Строгий', custom: 'Свой', noApis: 'Нет подходящих API', inherited: 'Наследуется',
    earlyPermission: 'Разрешите пользовательские скрипты для применения Custom с первого скрипта страницы.', earlyToggle: 'Включите Allow User Scripts в настройках расширения в браузере, затем перезапустите браузер и откройте этот редактор снова.', earlyUnsupported: 'В этом браузере недоступен доступ к пользовательским скриптам, необходимый для режима Custom.', earlyGrant: 'Разрешить Custom', earlySettings: 'Открыть настройки браузера', earlyRefresh: 'Обновить доступ', earlyDenied: 'Доступ к пользовательским скриптам не предоставлен.',
    groups: { graphics: 'Графика и экран', media: 'Аудио и медиа', device: 'Параметры устройства', hardware: 'Подключённые устройства', background: 'Фоновые процессы', browser: 'Браузер', system: 'Операционная система', ai: 'ИИ', storage: 'Хранилища', network: 'Сеть', identity: 'Идентификация' },
  }
};

export function formatApiValue(tagged, locale = 'en') {
  const t = STRINGS[locale === 'ru' ? 'ru' : 'en'];
  if (!tagged || tagged.kind === 'unset') return t.unset;
  if (tagged.kind !== 'value') return tagged.kind;
  return tagged.value === '' ? t.empty : typeof tagged.value === 'string' ? tagged.value : JSON.stringify(tagged.value);
}

export function filterApiValues(entry, search = '') {
  const query = search.trim().toLocaleLowerCase();
  const matches = value => !query || (value.label + ' ' + formatApiValue(value.value)).toLocaleLowerCase().includes(query);
  return { presets: entry.presets.filter(matches), userValues: entry.userValues.filter(matches) };
}

export function apiSearchText(entry, label = entry.name, translate) {
  const aliases = entry.id === 'webrtc' ? ' WebRTC ICE STUN TURN IPv4 IPv6 IP DTLS RTCPeerConnection device devices certificate certificates ' + webRtcText(translate, 'search_terms') : '';
  return (label + ' ' + entry.name + ' ' + entry.id + aliases).toLocaleLowerCase();
}

export function sameApiValue(left, right) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    return value;
  }
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

export function parseApiValueInput(entry, kind, input) {
  let tagged;
  if (kind !== 'value') tagged = { kind };
  else if (['string', 'language', 'autoplay', 'notification'].includes(entry.type)) tagged = { kind, value: input };
  else if (entry.type === 'number' || entry.type === 'integer') {
    if (input.trim() === '' || !Number.isFinite(Number(input))) return { ok: false, error: { code: 'invalid-number' } };
    tagged = { kind, value: Number(input) };
  } else {
    try { tagged = { kind, value: JSON.parse(input) }; }
    catch { return { ok: false, error: { code: 'invalid-json' } }; }
  }
  return validateApiValue(entry.id, tagged);
}

export function apiImportSummary(before, after) {
  const previous = new Map(before.apis.map(entry => [entry.id, entry]));
  const changed = after.apis.filter(entry => JSON.stringify(entry) !== JSON.stringify(previous.get(entry.id))).map(entry => ({ id: entry.id, name: entry.name, before: previous.get(entry.id), after: entry }));
  const hosts = new Set([...before.sites.map(site => site.host), ...after.sites.map(site => site.host)]);
  const sites = [...hosts].filter(host => JSON.stringify(before.sites.find(site => site.host === host)) !== JSON.stringify(after.sites.find(site => site.host === host))).sort();
  return { changed, sites, policyChanged: before.enabled !== after.enabled || before.antidetectEnabled !== after.antidetectEnabled || before.preset !== after.preset || before.webrtcNetworkPolicy !== after.webrtcNetworkPolicy };
}

export function createApiConfigurationUi({ h, useState, useEffect, useRef, useLocale = () => 'en', translate, browserApi = globalThis.chrome, downloadFile, maxImportBytes = API_CONFIGURATION_MAX_BYTES, featureFilter = {}, filters = ['all', 'hardware', 'os', 'network', 'browser', 'social'], renderGroupIcon = () => null }) {
  const { WorkspaceMaster } = createWorkspaceControlsUi({ h });
  const { UsageBadge, UsageContext } = createApiObservedUsageUi({ h, useLocale, translate });
  let nextGroupId = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const sameValue = sameApiValue;
  const localeStrings = () => {
    const locale = useLocale(), fallback = STRINGS[locale === 'ru' ? 'ru' : 'en'];
    const localize = (value, path = '') => Object.fromEntries(Object.entries(value).map(([key, text]) => {
      const suffix = path + key, id = 'antidetect_editor_' + suffix;
      return [key, typeof text === 'object' ? localize(text, suffix + '_') : (() => { const translated = translate?.(id); return translated && translated !== id ? translated : text; })()];
    }));
    return { locale, t: localize(fallback) };
  };
  const { WebRtcProfileFields, WebRtcNetworkPolicyPanel, WebRtcProfileOverview } = createWebRtcConfigurationUi({ h, useState, useEffect, useRef, translate });
  const { MediaCodecFields } = createMediaCodecConfigurationUi({ h, useRef, translate });
  const localValue = (value, locale) => {
    const key = !value || value.kind === 'unset' ? 'unset' : value.kind === 'value' && value.value === '' ? 'empty' : null;
    return key ? translate?.('antidetect_editor_' + key) || formatApiValue(value, locale) : formatApiValue(value, locale);
  };
  const displayValue = (entry, value, locale) => entry.id === 'webrtc' && value?.kind === 'value' ? formatWebRtcProfile(value.value, translate) : localValue(value, locale);
  const configurationError = error => error?.code === 'conflicting-webrtc-devices' ? webRtcText(translate, 'conflict') : (error?.path ? error.path + ': ' : '') + (translate?.('antidetect_editor_invalidValue') || STRINGS.en.invalidValue);
  const policyLabel = policy => webRtcText(translate, webRtcPolicyLabelKey(policy) ?? 'policy_system');
  function EarlyAccessNotice({ access, onRefresh }) {
    const { t } = localeStrings(), [busy, setBusy] = useState(false), [error, setError] = useState(''), active = useRef(false), mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function act(action) {
      if (active.current) return;
      active.current = true; setBusy(true); setError('');
      try { await action(); }
      catch (failure) { if (mounted.current) setError(failure?.message ?? t.error); }
      finally { active.current = false; if (mounted.current) setBusy(false); }
    }
    const grant = () => act(async () => {
      const accepted = await browserApi.permissions.request({ permissions: ['userScripts'] });
      if (!accepted) throw Error(t.earlyDenied);
      await onRefresh();
    });
    if (access === 'ready') return null;
    const chromeSetup = access === 'browser-toggle-required';
    return h('div', { class: 'api-config-early-access', 'data-api-early-access': access, children: [
      h('p', { children: access === 'permission-required' ? t.earlyPermission : chromeSetup ? t.earlyToggle : t.earlyUnsupported }),
      h('div', { class: 'blocking-actions', children: [
        access === 'permission-required' ? h('button', { type: 'button', class: 'button button--primary', disabled: busy, 'data-api-early-grant': true, onClick: grant, children: t.earlyGrant }) : null,
        chromeSetup ? h('button', { type: 'button', class: 'button button--primary', disabled: busy, 'data-api-early-settings': true, onClick: () => act(() => browserApi.tabs.create({ url: 'chrome://extensions/?id=' + browserApi.runtime.id })), children: t.earlySettings }) : null,
        h('button', { type: 'button', class: 'button', disabled: busy, 'data-api-early-refresh': true, onClick: () => act(onRefresh), children: t.earlyRefresh })
      ] }),
      error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null
    ] });
  }
  function Modal({ title, children, onClose, disabled = false, wide = false, returnFocus = null }) {
    const root = useRef(null);
    useEffect(() => {
      const previous = globalThis.document?.activeElement;
      const element = root.current;
      (element?.querySelector('[data-autofocus]') ?? element)?.focus();
      return () => { if (previous?.isConnected && previous !== globalThis.document?.body) previous.focus(); else returnFocus?.current?.querySelector('button')?.focus(); };
    }, []);
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!disabled) onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(root.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
      if (!nodes.length) { event.preventDefault(); return; }
      if (event.shiftKey && globalThis.document?.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && globalThis.document?.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    }
    return h('div', { class: 'api-config-overlay', children: h('section', { class: 'api-config-modal' + (wide ? ' api-config-modal--wide' : ''), role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref: root, onKeyDown: keydown, children: [h('h2', { children: title }), children] }) });
  }

  function ValueModal({ entry, value = null, initialValue = null, title = null, submitLabel = null, onSave, onClose, returnFocus }) {
    // Round 5: a new media-codecs value starts from the browser's own answer (the first preset lowers everything).
    const { t } = localeStrings(), selected = value?.value ?? initialValue?.value ?? (entry.type === 'media-codecs' ? MEDIA_CODEC_START : entry.presets[0]?.value) ?? { kind: 'value', value: entry.type === 'string' ? '' : entry.type === 'boolean' ? false : 0 };
    const [name, setName] = useState(value?.label ?? initialValue?.label ?? ''), [kind, setKind] = useState(selected.kind === 'unset' ? 'value' : selected.kind),
      [input, setInput] = useState(selected.kind === 'value' ? typeof selected.value === 'string' ? selected.value : JSON.stringify(selected.value, null, 2) : ''),
      [error, setError] = useState(''), [busy, setBusy] = useState(false), mounted = useRef(false), active = useRef(false), lastMedia = useRef(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    // The typed controls and the JSON view are one draft: the controls show the text when it is a valid value, and the last valid value (locked) while it is not.
    const typedMedia = entry.type === 'media-codecs' && kind === 'value' ? readMediaCodecInput(input) : null;
    if (typedMedia) lastMedia.current = typedMedia;
    const mediaFields = entry.type === 'media-codecs' && kind === 'value' ? h(MediaCodecFields, { value: typedMedia ?? lastMedia.current, invalid: typedMedia === null, disabled: busy, onChange: next => setInput(JSON.stringify(next, null, 2)) }) : null;
    async function save(event) {
      event.preventDefault();
      if (active.current) return;
      if (!name.trim()) { setError(t.nameRequired); return; }
      const result = parseApiValueInput(entry, kind, input);
      if (!result.ok) { setError(entry.id === 'webrtc' ? webRtcText(translate, 'invalid') : result.error?.code === 'invalid-number' ? t.invalidNumber : t.invalidValue); return; }
      active.current = true; setBusy(true); setError('');
      try {
        const next = { id: value?.id ?? nextApiValueId(entry.userValues), label: name.trim(), value: result.value };
        await onSave(next);
        if (mounted.current) onClose();
      } catch (failure) { if (mounted.current) setError(failure?.message || t.error); }
      finally { active.current = false; if (mounted.current) setBusy(false); }
    }
    return h(Modal, { title: title ?? (value ? t.edit : t.create), onClose, disabled: busy, returnFocus, children: h('form', { onSubmit: save, class: 'api-config-form', children: [
      h('label', { children: [t.label, h('input', { type: 'text', maxLength: 160, value: name, 'data-autofocus': true, 'data-api-value-name': true, disabled: busy, onInput: event => setName(event.currentTarget.value) })] }),
      entry.allowNull || entry.allowUndefined ? h('label', { children: [t.valueType, h('select', { value: kind, disabled: busy, 'data-api-value-kind': true, onChange: event => setKind(event.currentTarget.value), children: [h('option', { value: 'value', children: t.actual }), entry.allowNull ? h('option', { value: 'null', children: 'null' }) : null, entry.allowUndefined ? h('option', { value: 'undefined', children: 'undefined' }) : null] })] }) : null,
      mediaFields,
      kind === 'value' ? entry.id === 'webrtc' ? h(WebRtcProfileFields, { value: (() => { try { return JSON.parse(input); } catch { return WEBRTC_PROFILE_DEFAULT; } })(), disabled: busy, onChange: value => setInput(JSON.stringify(value)) }) : h('label', { children: [t.value, entry.type === 'boolean' ? h('select', { value: input, disabled: busy, 'data-api-value-input': true, onChange: event => setInput(event.currentTarget.value), children: [h('option', { value: 'true', children: 'true' }), h('option', { value: 'false', children: 'false' })] }) : h('textarea', { value: input, rows: ['string', 'language', 'integer', 'number'].includes(entry.type) ? 3 : 8, maxLength: 65536, spellcheck: false, dir: 'ltr', disabled: busy, 'data-api-value-input': true, onInput: event => setInput(event.currentTarget.value) }), h('small', { children: (t.hints[entry.type] ?? t.hints.object ?? 'JSON') + ' · ' + entry.valueHint })] }) : null,
      error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null,
      h('div', { class: 'api-config-actions', children: [h('button', { type: 'button', class: 'button', disabled: busy, onClick: onClose, children: t.cancel }), h('button', { type: 'submit', class: 'button button--primary', disabled: busy, 'data-api-value-save': true, children: submitLabel ?? t.save })] })
    ] }) });
  }

  function CustomValueEditor({ entry, onChange, onEditingChange, disabled = false }) {
    const { t, locale } = localeStrings(), [open, setOpen] = useState(false), [search, setSearch] = useState(''), [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), active = useRef(false), mounted = useRef(false), picker = useRef(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { onEditingChange?.(editing !== null || deleting); return () => onEditingChange?.(false); }, [editing, deleting]);
    useEffect(() => {
      if (!open) return undefined;
      const close = event => { if (picker.current && !picker.current.contains(event.target)) setOpen(false); };
      globalThis.document?.addEventListener('pointerdown', close);
      return () => globalThis.document?.removeEventListener('pointerdown', close);
    }, [open]);
    const currentUser = entry.userValues.find(value => sameValue(value.value, entry.selected)), filtered = filterApiValues(entry, search);
    async function change(patch, message, persist = false) {
      if (active.current || disabled) throw Error(t.error);
      active.current = true; setBusy(true); setError('');
      try { await onChange(patch, { persist }); if (mounted.current) setStatus(message ?? (persist ? t.saved : t.selected)); }
      catch (failure) { if (mounted.current) setError(failure?.message || t.error); throw failure; }
      finally { active.current = false; if (mounted.current) setBusy(false); }
    }
    async function select(event) {
      const selected = event.currentTarget.value;
      if (selected === ':create') { setEditing({ create: true }); setOpen(false); return; }
      const value = selected.startsWith('p:') ? entry.presets.find(value => value.id === selected.slice(2)) : entry.userValues.find(value => value.id === selected.slice(2));
      if (!value) return;
      try { await change({ selected: clone(value.value), mode: 'custom' }); setOpen(false); } catch { /* The inline message owns the failure. */ }
    }
    const selectedId = currentUser ? 'u:' + currentUser.id : (() => { const preset = entry.presets.find(value => sameValue(value.value, entry.selected)); return preset ? 'p:' + preset.id : ''; })();
    return h('div', { class: 'api-value-editor', 'data-api-value-editor': entry.id, ref: picker, children: [
      h('div', { class: 'api-value-editor__controls', children: [
        h('button', { type: 'button', class: 'api-value-picker', disabled: disabled || busy || !entry.customSupported, 'aria-label': t.showValue + ': ' + entry.name, 'aria-haspopup': 'dialog', 'aria-expanded': open, title: displayValue(entry, entry.inheritedSelected ?? entry.selected, locale) + (entry.id !== 'webrtc' && entry.customReason ? ' · ' + entry.customReason : ''), onClick: () => { setOpen(!open); setSearch(''); }, children: [h('span', { children: (entry.inheritedSelected ? t.inherited + ': ' : '') + displayValue(entry, entry.inheritedSelected ?? entry.selected, locale) }), h('span', { 'aria-hidden': true, children: '⌄' })] }),
        currentUser ? h('button', { type: 'button', class: 'button button--text api-value-action', disabled: disabled || busy, onClick: () => setEditing(currentUser), 'aria-label': t.edit + ': ' + currentUser.label, children: t.edit }) : null,
        currentUser ? h('button', { type: 'button', class: 'button button--text api-value-action', disabled: disabled || busy, onClick: () => setDeleting(true), 'aria-label': t.delete + ': ' + currentUser.label, children: t.delete }) : null
      ] }),
      open ? h('div', { class: 'api-value-dropdown', role: 'dialog', 'aria-label': t.choose + ': ' + entry.name, onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); picker.current?.querySelector('button')?.focus(); } }, children: [
        h('input', { type: 'search', value: search, 'aria-label': t.search, placeholder: t.search, onInput: event => setSearch(event.currentTarget.value), autoFocus: true }),
        h('select', { size: Math.max(3, Math.min(9, filtered.presets.length + filtered.userValues.length + 3)), value: selectedId, 'aria-label': t.choose, 'data-api-value-list': entry.id, disabled: busy, onChange: select, children: [
          h('option', { value: '', disabled: true, children: t.choose }),
          filtered.presets.length ? h('optgroup', { label: t.presets, children: filtered.presets.map(value => h('option', { value: 'p:' + value.id, key: value.id, children: (entry.id === 'webrtc' && entry.presets.includes(value) ? '' : value.label + ' · ') + displayValue(entry, value.value, locale) })) }) : null,
          filtered.userValues.length ? h('optgroup', { label: t.own, children: filtered.userValues.map(value => h('option', { value: 'u:' + value.id, key: value.id, children: (entry.id === 'webrtc' && entry.presets.includes(value) ? '' : value.label + ' · ') + displayValue(entry, value.value, locale) })) }) : null,
          h('option', { value: ':create', children: '+ ' + t.create })
        ] }),
        !filtered.presets.length && !filtered.userValues.length ? h('p', { children: t.noMatches }) : null
      ] }) : null,
      status ? h('span', { class: 'sr-only', role: 'status', children: status }) : null,
      error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null,
      editing ? h(ValueModal, { key: editing.id ?? 'create', entry, returnFocus: picker, value: editing.create ? null : editing, onClose: () => setEditing(null), onSave: async next => change({ mode: 'custom', selected: clone(next.value), userValues: editing.create ? [...entry.userValues, next] : entry.userValues.map(value => value.id === next.id ? next : value) }, t.saved, true) }) : null,
      deleting ? h(Modal, { title: t.confirmDelete, returnFocus: picker, onClose: () => setDeleting(false), disabled: busy, children: [h('p', { children: currentUser?.label }), h('div', { class: 'api-config-actions', children: [h('button', { type: 'button', class: 'button', disabled: busy, onClick: () => setDeleting(false), children: t.cancel }), h('button', { type: 'button', class: 'button button--primary', disabled: busy, 'data-api-value-delete': true, onClick: async () => { try { await change({ mode: entry.mode === 'custom' ? 'bypass' : entry.mode, selected: { kind: 'unset' }, userValues: entry.userValues.filter(value => value.id !== currentUser.id) }, t.deleted, true); setDeleting(false); } catch { /* Keep the confirmation available for retry. */ } }, children: t.confirm })] })] }) : null
    ] });
  }

  function ApiConfigurationTransfer({ configuration, savedConfiguration = configuration, revision, onCommit, disabled = false }) {
    const { t, locale } = localeStrings(), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [undo, setUndo] = useState(null), input = useRef(null), mounted = useRef(false), active = useRef(false), fileRequest = useRef(0), latest = useRef({ configuration, savedConfiguration, revision });
    latest.current = { configuration, savedConfiguration, revision };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; fileRequest.current++; }; }, []);
    async function commit(next, expectedRevision, message) {
      if (active.current || disabled) throw Error(t.error);
      active.current = true; setBusy(true); setError('');
      try { const result = await onCommit(next, expectedRevision); if (mounted.current) setStatus(message); return result; }
      catch (failure) { if (mounted.current) setError(failure?.message || t.error); throw failure; }
      finally { active.current = false; if (mounted.current) setBusy(false); }
    }
    async function readFile(event) {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file || active.current) return;
      const token = ++fileRequest.current;
      setError(''); setStatus(''); setPreview(null);
      if (file.size > maxImportBytes) { setError(t.tooLarge); setBusy(false); return; }
      setBusy(true);
      try {
        const imported = importApiConfiguration(await file.text());
        if (!mounted.current || token !== fileRequest.current) return;
        if (!imported.ok) { setError(imported.error?.code === 'conflicting-webrtc-devices' ? configurationError(imported.error) : t.invalidJson); return; }
        // ADR-084: Undo restores persisted settings, independently of the editable preview.
        const current = latest.current, baseline = validateApiConfiguration(current.savedConfiguration);
        if (!baseline.ok) { setError(t.error); return; }
        setPreview({ kind: 'import', configuration: imported.value, before: clone(current.configuration), undoConfiguration: clone(baseline.value), expectedRevision: current.revision, migrated: imported.migrated === true, summary: apiImportSummary(current.configuration, imported.value) });
      } catch { if (mounted.current && token === fileRequest.current) setError(t.invalidJson); }
      finally { if (mounted.current && token === fileRequest.current) setBusy(false); }
    }
    function exportPreview() {
      try { setPreview({ kind: 'export', json: exportApiConfiguration(configuration) }); setError(''); }
      catch (failure) { setError(failure?.message ?? t.error); }
    }
    async function apply() {
      try {
        const result = await commit(preview.configuration, preview.expectedRevision, t.imported);
        if (!mounted.current) return;
        setUndo({ configuration: preview.undoConfiguration, expectedRevision: result?.revision ?? preview.expectedRevision + 1 }); setPreview(null);
      } catch { /* The existing settings and preview remain available. */ }
    }
    async function undoImport() {
      try { await commit(undo.configuration, undo.expectedRevision, t.undone); if (mounted.current) setUndo(null); } catch { /* The revision gate protects later edits. */ }
    }
    function download() {
      if (downloadFile) downloadFile({ text: preview.json, mime: 'application/json', fileName: 'detect-expert-api-configuration-v1.json' });
      else {
        const url = URL.createObjectURL(new Blob([preview.json], { type: 'application/json' })), anchor = globalThis.document.createElement('a');
        anchor.href = url; anchor.download = 'detect-expert-api-configuration-v1.json'; anchor.hidden = true; globalThis.document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setPreview(null);
    }
    return h('div', { class: 'api-config-transfer', 'data-api-config-transfer': true, children: [
      h('div', { class: 'api-config-transfer__buttons', children: [h('input', { type: 'file', accept: '.json,application/json', hidden: true, ref: input, onChange: readFile, 'data-api-config-file': true }), h('button', { class: 'button', type: 'button', disabled: disabled || busy, 'data-api-config-import': true, onClick: () => input.current?.click(), children: t.import }), h('button', { class: 'button', type: 'button', disabled: disabled || busy, 'data-api-config-export': true, onClick: exportPreview, children: t.export }), undo ? h('button', { class: 'button button--text', type: 'button', disabled: disabled || busy || revision !== undo.expectedRevision, onClick: undoImport, 'data-api-config-undo': true, children: t.undo }) : null] }),
      status ? h('p', { class: 'api-config-status', role: 'status', children: status }) : null,
      error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null,
      preview ? h(Modal, { title: preview.kind === 'import' ? t.previewImport : t.previewExport, onClose: () => setPreview(null), disabled: busy, wide: true, children: [
        preview.kind === 'import' ? h('div', { class: 'api-config-import-summary', children: [
          h('p', { children: t.format + ': ' + preview.configuration.formatVersion + ' · ' + t.all + ': ' + preview.configuration.apis.length }),
          h('p', { children: t.changed + ': ' + preview.summary.changed.length + ' · ' + t.changedSites + ': ' + preview.summary.sites.length }),
          preview.before.webrtcNetworkPolicy !== preview.configuration.webrtcNetworkPolicy ? h('p', { 'data-webrtc-policy-import-change': true, children: [webRtcText(translate, 'network_title') + ': ', policyLabel(preview.before.webrtcNetworkPolicy), ' → ', policyLabel(preview.configuration.webrtcNetworkPolicy)] }) : null,
          preview.migrated ? h('p', { children: t.migrated }) : null,
          h('ul', { class: 'api-config-change-list', children: preview.summary.changed.map(change => h('li', { key: change.id, children: [h('strong', { children: change.name }), ' · ', change.before?.mode ?? '—', ' → ', change.after.mode, h('code', { children: formatApiValue(change.before?.selected, locale) + ' → ' + formatApiValue(change.after.selected, locale) })] })) }),
          h('pre', { class: 'api-config-json', dir: 'ltr', tabIndex: 0, 'aria-label': t.previewImport, children: exportApiConfiguration(preview.configuration) })
        ] }) : h('pre', { class: 'api-config-json', dir: 'ltr', tabIndex: 0, 'aria-label': t.previewExport, children: preview.json }),
        error ? h('p', { class: 'api-config-error', role: 'alert', children: error }) : null,
        h('div', { class: 'api-config-actions', children: [h('button', { type: 'button', class: 'button', disabled: busy, onClick: () => setPreview(null), children: t.cancel }), h('button', { type: 'button', class: 'button button--primary', disabled: busy || preview.kind === 'import' && revision !== preview.expectedRevision, 'data-api-config-apply': preview.kind, onClick: preview.kind === 'import' ? apply : download, children: preview.kind === 'import' ? t.apply : t.download })] })
      ] }) : null
    ] });
  }
  function categoryIcon(id) {
    const icons = {
      all: [h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }), h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 })],
      hardware: [h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }), h('rect', { x: 9, y: 9, width: 6, height: 6, rx: 1 }), h('path', { d: 'M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3M18 9h3m-3 6h3' })],
      os: [h('path', { d: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5' })],
      network: [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z' })],
      browser: [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }), h('path', { d: 'M3 9h18M7 6.5h.01M10 6.5h.01' })],
      social: [h('circle', { cx: 9, cy: 8, r: 3.5 }), h('path', { d: 'M2.5 21v-2a6.5 6.5 0 0 1 13 0v2M16 4.7a3.5 3.5 0 0 1 0 6.6M21.5 21v-2a6.5 6.5 0 0 0-4-6' })],
      spoofed: [h('path', { d: 'm4 16 11-11 4 4L8 20H4v-4Zm8-8 4 4' })],
      blocked: [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'm6 6 12 12' })],
    };
    return h('svg', { class: 'api-config-category-icon', viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false, children: icons[id] });
  }
  function CategoryFilters({ value, counts, onChange, focusRef }) {
    const { t, locale } = localeStrings(), localRef = useRef(null), root = focusRef ?? localRef;
    const names = locale === 'ru' ? { all: 'Все', hardware: 'Аппаратура', os: 'ОС', network: 'Сеть', browser: 'Браузер', social: 'Соцсети' } : { all: 'All', hardware: 'Hardware', os: 'OS', network: 'Network', browser: 'Browser', social: 'Social' };
    function keydown(event) {
      const rtl = globalThis.document?.documentElement?.dir === 'rtl', delta = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (!delta && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = filters.indexOf(value), next = event.key === 'Home' ? filters[0] : event.key === 'End' ? filters.at(-1) : filters[(index + delta + filters.length) % filters.length];
      onChange(next); root.current?.querySelector('[data-protection-filter="' + next + '"]')?.focus();
    }
    return h('div', { class: 'blocking-chips api-config-categories', role: 'radiogroup', 'aria-label': t.allGroups, ref: root, onKeyDown: keydown, 'data-protection-filters': true, children: filters.map(id => {
      const key = 'protection_filter_' + id, translated = translate?.(key), label = translated && translated !== key ? translated : names[id] ?? id;
      return h('button', { type: 'button', role: 'radio', 'aria-checked': value === id, tabIndex: value === id ? 0 : -1, class: 'blocking-chip' + (value === id ? ' is-selected' : ''), 'data-protection-filter': id, onClick: () => onChange(id), key: id, children: [categoryIcon(id), h('span', { class: 'blocking-chip__label', children: label }), h('span', { class: 'blocking-chip__count', 'aria-hidden': true, 'data-protection-filter-count': id, children: counts[id] ?? 0 })] });
    }) });
  }
  function ModeFilters({ value, counts, onChange, focusRef }) {
    const { locale } = localeStrings(), localRef = useRef(null), root = focusRef ?? localRef, modes = ['spoofed', 'blocked'];
    const text = (key, fallback) => { const message = translate?.(key); return message && message !== key ? message : fallback; };
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onChange('all'); return; }
      const rtl = globalThis.document?.documentElement?.dir === 'rtl', delta = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (!delta && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const focused = event.target?.closest?.('[data-api-mode-filter]')?.getAttribute('data-api-mode-filter'), current = modes.includes(focused) ? focused : modes.includes(value) ? value : modes[0];
      const next = event.key === 'Home' ? modes[0] : event.key === 'End' ? modes.at(-1) : modes[(modes.indexOf(current) + delta + modes.length) % modes.length];
      onChange(next); root.current?.querySelector('[data-api-mode-filter="' + next + '"]')?.focus();
    }
    return h('div', { class: 'blocking-chips api-config-mode-filters', role: 'group', ref: root, onKeyDown: keydown, 'data-api-mode-filters': true,
      'aria-label': text('protection_mode_filter_label', locale === 'ru' ? 'Фильтр API по режиму' : 'Filter APIs by mode'), children: modes.map((id, index) => {
        const selected = value === id, label = text('protection_mode_filter_' + id, id === 'spoofed' ? 'Spoofed' : 'Blocked');
        return h('button', { type: 'button', class: 'blocking-chip' + (selected ? ' is-selected' : ''), 'aria-pressed': selected,
          tabIndex: selected || value === 'all' && index === 0 ? 0 : -1, 'data-api-mode-filter': id, key: id,
          title: selected ? text('protection_mode_filter_reset', locale === 'ru' ? 'Показать все режимы' : 'Show all modes') : label,
          onClick: () => onChange(selected ? 'all' : id), children: [categoryIcon(id), h('span', { class: 'blocking-chip__label', children: label }), h('span', { class: 'blocking-chip__count', 'aria-hidden': true, 'data-api-mode-filter-count': id, children: counts[id] ?? 0 })] });
      }) });
  }
  function ModeControl({ entry, label = entry.name, disabled, onChange, earlyAccess = 'ready' }) {
    // ADR-103: As in preset, Allow, Block, Custom value; stored modes stay bypass/off/on/custom.
    const root = useRef(null), options = ['bypass', 'off', 'on', 'custom'], modeText = redesignLabels(localeStrings().locale);
    const available = options.filter(mode => (mode !== 'custom' || entry.customSupported && earlyAccess === 'ready') && (mode !== 'on' || !API_CUSTOM_ONLY_IDS.includes(entry.id)));
    const focusMode = available.includes(entry.mode) ? entry.mode : available[0];
    function keydown(event) {
      const rtl = globalThis.document?.documentElement?.dir === 'rtl';
      const delta = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (!delta && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault(); if (disabled) return;
      const index = available.indexOf(entry.mode), next = event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : available[(index + delta + available.length) % available.length];
      onChange(next); root.current?.querySelector('[data-protection-state="' + next + '"]')?.focus();
    }
    return h('div', { class: 'blocking-segmented blocking-segmented--states api-config-modes', role: 'radiogroup', 'aria-label': label, onKeyDown: keydown, ref: root, children: options.map(mode => h('button', { type: 'button', role: 'radio', class: 'blocking-segmented__option blocking-segmented__option--' + mode + (mode === entry.mode ? ' is-selected' : ''), 'aria-checked': mode === entry.mode, tabIndex: mode === focusMode ? 0 : -1, disabled: disabled || mode === 'custom' && (!entry.customSupported || earlyAccess !== 'ready') || mode === 'on' && API_CUSTOM_ONLY_IDS.includes(entry.id), title: mode === 'custom' || mode === 'on' && API_CUSTOM_ONLY_IDS.includes(entry.id) ? entry.customReason ?? entry.valueHint : undefined, 'data-protection-state': mode, onClick: () => onChange(mode), children: mode === 'bypass' ? modeText.modeInherit : mode === 'off' ? modeText.modeAllow : mode === 'on' ? modeText.modeBlock : modeText.modeCustom, key: mode })) });
  }
  function ApiConfigurationEditor({ tabId = null, global = true, presentation = 'guard', fixedCategory = null, hideWebRtc = false, categoryOverrides = null, active: panelActive = true, observedUsage = null, observedOnly, onObservedOnlyChange, hideUsageContext = false }) {
    const { t, locale } = localeStrings(), [saved, setSaved] = useState(null), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [modeAction, setModeAction] = useState(null), [rtcDialog, setRtcDialog] = useState(null),
      [scope, setScope] = useState(tabId === null && global ? 'global' : 'site'), [host, setHost] = useState(null), [hostInput, setHostInput] = useState(''), [search, setSearch] = useState(''), [group, setGroup] = useState('all'), [category, setCategory] = useState('all'), [modeFilter, setModeFilter] = useState('all'), [configured, setConfigured] = useState(false), [customOnly, setCustomOnly] = useState(false), [announced, setAnnounced] = useState(null), [wasmExpanded, setWasmExpanded] = useState(false),
      mounted = useRef(false), generation = useRef(0), active = useRef(false), request = useRef(0), networkRequest = useRef(0), networkDeferred = useRef(false), networkSchedule = useRef(null), draftRef = useRef(null), savedRef = useRef(null), baseRef = useRef(null), revisionRef = useRef(null), reloadedRevision = useRef(null), reloadWatch = useRef(null), reloadIntent = useRef(null), editorRef = useRef(null), scopeRef = useRef(scope), hostRef = useRef(null), editingValues = useRef(new Set()), filterTouched = useRef(false), shownRef = useRef(0), filterRef = useRef(null), modeFilterRef = useRef(null), wasmToggleRef = useRef(null), wasmChildrenRef = useRef(null), wasmGroupId = useRef(null), rtcShortcutRef = useRef(null);
    const [localObservedOnly, setLocalObservedOnly] = useState(false), [collapsedGroups, setCollapsedGroups] = useState([]);
    const usageOnly = observedOnly === undefined ? localObservedOnly : observedOnly;
    const filterObserved = usageOnly && observedUsage?.status === 'ready';
    const changeObservedOnly = value => { filterTouched.current = true; if (typeof onObservedOnlyChange === 'function') onObservedOnlyChange(value); else setLocalObservedOnly(value); };
    if (wasmGroupId.current === null) wasmGroupId.current = 'api-config-wasm-' + (++nextGroupId);
    useEffect(() => { if (search.trim() || group === 'webassembly' || configured || modeFilter !== 'all' || filterObserved) setWasmExpanded(true); }, [search, group, configured, modeFilter, filterObserved]);
    // A search or an explicit group choice reveals matches inside collapsed sections.
    useEffect(() => { if (search.trim() || group !== 'all') setCollapsedGroups(previous => previous.length ? [] : previous); }, [search, group]);
    draftRef.current = draft; savedRef.current = saved; hostRef.current = host; scopeRef.current = scope;
    const validTab = tabId === null || Number.isInteger(tabId) && tabId >= 0 && tabId <= 2147483647;
    const readState = raw => {
      if (!raw || raw.schemaVersion !== 1 || raw.type !== 'api-config-state' || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !['ready', 'inactive', 'error'].includes(raw.registration) || typeof raw.reloadRequired !== 'boolean' || raw.host !== null && typeof raw.host !== 'string' || raw.documentId !== null && typeof raw.documentId !== 'string') return null;
      const configuration = validateApiConfiguration(raw.configuration);
      const earlyAccess = raw.earlyAccess ?? 'unsupported';
      return configuration.ok && ['ready', 'permission-required', 'browser-toggle-required', 'unsupported'].includes(earlyAccess) ? { ...raw, earlyAccess, configuration: configuration.value } : null;
    };
    const failureMessage = raw => raw?.code === 'stale-revision' ? t.stale : raw?.code === 'privacy-permission-required' ? webRtcText(translate, 'permission_save') : raw?.code === 'conflicting-webrtc-devices' ? webRtcText(translate, 'conflict') : t.error;
    function completedReload(state) {
      if (state.registration === 'error') { reloadIntent.current = null; return state; }
      const intent = reloadIntent.current;
      if (!intent?.acknowledged || intent.revision !== state.revision || state.documentId === null || state.documentId === intent.documentId) return state;
      reloadedRevision.current = state.revision; reloadIntent.current = null;
      setModeAction(previous => previous?.phase === 'saved' ? { ...previous, pendingReload: false } : previous);
      return { ...state, reloadRequired: false };
    }
    function observeReload(target, revision, epoch) {
      let closed = false, observed = false, reading = false, again = false, reads = 0, resolveObservation, resolveDeadline;
      const observation = new Promise(resolve => { resolveObservation = resolve; }), deadline = new Promise(resolve => { resolveDeadline = resolve; });
      const events = (globalThis.browser?.runtime?.id === browserApi.runtime?.id ? globalThis.browser : browserApi).webNavigation?.onCommitted;
      const finish = state => { if (!observed) { observed = true; events?.removeListener(committed); resolveObservation(state); } };
      const inspect = async () => {
        if (closed || observed || reads >= 8) return;
        if (reading) { again = true; return; }
        reading = true; reads++;
        try {
          const response = await browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId });
          if (closed || !mounted.current || epoch !== generation.current) return;
          const state = readState(response);
          if (state && state.revision === revision && state.documentId !== null && state.documentId !== target.documentId) finish(state);
        } catch { /* A bounded missing read leaves the saved mode pending a page reload. */ }
        finally { reading = false; if (again) { again = false; void inspect(); } }
      };
      const committed = details => { if (details.tabId === tabId && details.frameId === 0) void inspect(); };
      events?.addListener(committed);
      const timer = setTimeout(() => { finish(null); resolveDeadline(null); }, 2000);
      const cancel = () => { closed = true; clearTimeout(timer); events?.removeListener(committed); finish(null); resolveDeadline(null); };
      return { observation, deadline, inspect, cancel };
    }
    async function refreshNetworkPolicy() {
      if (!validTab || active.current) throw Error(t.error);
      const epoch = generation.current, revision = revisionRef.current, token = ++networkRequest.current, response = await browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId });
      if (!mounted.current || epoch !== generation.current || revision !== revisionRef.current || token !== networkRequest.current) return;
      if (active.current) { networkDeferred.current = true; return; }
      const state = readState(response);
      if (!state) throw Error(failureMessage(response));
      setSaved(previous => previous ? { ...previous, webrtcNetwork: state.webrtcNetwork } : previous);
      if (savedRef.current) savedRef.current = { ...savedRef.current, webrtcNetwork: state.webrtcNetwork };
      if (revisionRef.current !== state.revision) setError(t.stale);
    }
    async function grantNetworkPolicy() {
      const accepted = await browserApi.permissions?.request({ permissions: ['privacy'] });
      if (!accepted) { const failure = Error(); failure.code = 'permission-denied'; throw failure; }
      await refreshNetworkPolicy();
    }
    async function refresh(discard = true) {
      if (!validTab || active.current) return;
      const token = ++request.current, epoch = generation.current;
      setBusy(true); setError('');
      try {
        const response = await browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId });
        if (!mounted.current || epoch !== generation.current || token !== request.current) return;
        const rawState = readState(response), state = rawState ? completedReload(rawState) : null;
        if (!state) { setError(failureMessage(response)); return; }
        const hasDraft = editingValues.current.size > 0 || draftRef.current && baseRef.current && !sameValue(draftRef.current, baseRef.current);
        setSaved(state); savedRef.current = state;
        if (discard || !hasDraft) {
          setDraft(state.configuration); draftRef.current = state.configuration; baseRef.current = state.configuration; revisionRef.current = state.revision;
          setMessage(''); if (discard) setModeAction(null);
        } else if (revisionRef.current !== state.revision) setError(t.stale);
        if (hostRef.current === null) setHost(state.host ?? state.configuration.sites[0]?.host ?? null);
      } catch { if (mounted.current && epoch === generation.current && token === request.current) setError(t.error); }
      finally { if (mounted.current && epoch === generation.current && token === request.current) setBusy(false); }
    }
    useEffect(() => {
      mounted.current = true; generation.current++; active.current = false; reloadWatch.current?.cancel(); reloadWatch.current = null; reloadIntent.current = null; editingValues.current.clear(); setRtcDialog(null); setSaved(null); setDraft(null); setModeAction(null); draftRef.current = null; savedRef.current = null; baseRef.current = null; revisionRef.current = null; reloadedRevision.current = null; setHost(null); hostRef.current = null;
      void refresh(true);
      const storage = (changes, area) => { if (area === 'local' && !active.current && (Object.hasOwn(changes, 'api-configuration:v1') || Object.hasOwn(changes, 'api-config:v1') || Object.hasOwn(changes, 'protection:v1'))) void refresh(false); };
      const nativeEvents = globalThis.browser?.runtime?.id === browserApi.runtime?.id ? globalThis.browser : browserApi;
      const navigation = details => { if (details.tabId === tabId && details.frameId === 0 && !active.current) void refresh(false); };
      let disposed = false, binding = 0, policyEvent = null, policyTimer = null, policyReading = false, policyAgain = false;
      const schedulePolicyRefresh = () => {
        if (disposed) return;
        if (policyReading) { policyAgain = true; return; }
        if (policyTimer !== null) return;
        policyTimer = setTimeout(() => {
          policyTimer = null;
          if (active.current) { networkDeferred.current = true; return; }
          policyReading = true;
          void refreshNetworkPolicy().catch(() => {}).finally(() => { policyReading = false; if (policyAgain) { policyAgain = false; schedulePolicyRefresh(); } });
        }, 50);
      };
      networkSchedule.current = schedulePolicyRefresh;
      async function bindPolicyEvent() {
        const token = ++binding;
        try {
          const permitted = await nativeEvents.permissions?.contains?.({ permissions: ['privacy'] });
          if (disposed || token !== binding) return;
          const next = permitted === true ? nativeEvents.privacy?.network?.webRTCIPHandlingPolicy?.onChange ?? null : null;
          if (next === policyEvent) return;
          try { policyEvent?.removeListener(schedulePolicyRefresh); } catch { /* Permission revocation can invalidate a native event object. */ }
          policyEvent = next; policyEvent?.addListener(schedulePolicyRefresh);
        } catch { /* The current status is read through the controller; unavailable native events add no writes. */ }
      }
      const privacyPermissionChanged = details => { if (details.permissions?.includes('privacy')) { void bindPolicyEvent(); schedulePolicyRefresh(); } };
      nativeEvents.storage?.onChanged?.addListener(storage); nativeEvents.webNavigation?.onCommitted?.addListener(navigation);
      nativeEvents.permissions?.onAdded?.addListener(privacyPermissionChanged); nativeEvents.permissions?.onRemoved?.addListener(privacyPermissionChanged); void bindPolicyEvent();
      return () => { mounted.current = false; generation.current++; reloadWatch.current?.cancel(); reloadWatch.current = null; reloadIntent.current = null; request.current++; networkRequest.current++; networkDeferred.current = false; networkSchedule.current = null; disposed = true; binding++; clearTimeout(policyTimer); nativeEvents.storage?.onChanged?.removeListener(storage); nativeEvents.webNavigation?.onCommitted?.removeListener(navigation); nativeEvents.permissions?.onAdded?.removeListener(privacyPermissionChanged); nativeEvents.permissions?.onRemoved?.removeListener(privacyPermissionChanged); try { policyEvent?.removeListener(schedulePolicyRefresh); } catch { /* The browser may already have revoked this event. */ } };
    }, [tabId]);
    useEffect(() => {
      if (!filterTouched.current) return undefined;
      setAnnounced(null);
      const timer = setTimeout(() => setAnnounced(shownRef.current), 500);
      return () => clearTimeout(timer);
    }, [category, search, group, configured, customOnly, modeFilter, draft, scope, host, filterObserved]);
    async function commit(configuration, expectedRevision = revisionRef.current, reload = false, options = {}) {
      if (!panelActive || active.current || !validTab || expectedRevision === null) throw Error(t.error);
      const checked = validateApiConfiguration(configuration);
      if (!checked.ok) { const message = configurationError(checked.error); setError(message); throw Error(message); }
      const retainedDraft = options.preserveDraft ? validateApiConfiguration(options.preserveDraft) : null;
      if (retainedDraft && !retainedDraft.ok) { const message = configurationError(retainedDraft.error); setError(message); throw Error(message); }
      // Bind a reload to the source document present before the user's action.
      // A page reached while persistence is pending must never be reloaded instead.
      const target = options.reloadTarget === undefined ? (reload && tabId !== null && savedRef.current?.documentId ? { documentId: savedRef.current.documentId, host: savedRef.current.host } : null) : options.reloadTarget;
      active.current = true; ++request.current; setBusy(true); setError('');
      reloadIntent.current = null;
      if (!options.modeId) setModeAction(null);
      const epoch = generation.current;
      let reloadRequested = false, reloadAcknowledged = false;
      try {
        const response = await browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision, configuration: checked.value });
        if (!mounted.current || epoch !== generation.current) throw Error(t.error);
        const state = readState(response);
        if (!state) throw Error(failureMessage(response));
        const nextDraft = retainedDraft?.value ?? state.configuration;
        setSaved(state); savedRef.current = state; setDraft(nextDraft); draftRef.current = nextDraft; baseRef.current = state.configuration; revisionRef.current = state.revision; setMessage(state.registration === 'error' ? '' : t.configSaved);
        let reloaded = false, applicationFailed = state.registration === 'error';
        if (reload && state.registration !== 'error' && tabId !== null && target !== null && state.documentId === target.documentId && state.host === target.host) {
          // Listen before dispatch: a fast native commit may precede its ACK.
          const watcher = observeReload(target, state.revision, epoch); reloadWatch.current = watcher;
          const intent = { revision: state.revision, documentId: target.documentId, acknowledged: false }; reloadIntent.current = intent;
          try {
            const command = browserApi.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protection-reload', tabId, documentId: target.documentId }).then(result => {
              if (mounted.current && epoch === generation.current && reloadIntent.current === intent && revisionRef.current === state.revision) {
                if (result?.schemaVersion === 1 && result.type === 'protection-state') { intent.acknowledged = true; reloadAcknowledged = true; if (!active.current) void refresh(false); }
                else reloadIntent.current = null;
              }
              return result;
            });
            const result = await Promise.race([command, watcher.deadline]);
            if (result !== null && mounted.current && epoch === generation.current) {
              if (result?.schemaVersion !== 1 || result.type !== 'protection-state') throw Error(failureMessage(result));
              void watcher.inspect();
              const current = await watcher.observation;
              if (current && mounted.current && epoch === generation.current) {
                applicationFailed = current.registration === 'error';
                const next = completedReload(current); setSaved(next); savedRef.current = next;
                if (!applicationFailed) { reloaded = true; reloadRequested = true; }
              }
            }
          } finally { watcher.cancel(); if (reloadWatch.current === watcher) reloadWatch.current = null; }
        }
        if (options.modeId && mounted.current && epoch === generation.current) setModeAction({ id: options.modeId, phase: applicationFailed ? 'error' : 'saved', pendingReload: !reloaded, error: applicationFailed ? t.activationFailed : null });
        return state;
      } catch (failure) { if (mounted.current && epoch === generation.current) setError(failure?.message ?? t.error); throw failure; }
      finally { active.current = false; if (mounted.current && epoch === generation.current) { setBusy(false); if (reloadRequested || reloadAcknowledged) await refresh(false); if (networkDeferred.current) { networkDeferred.current = false; networkSchedule.current?.(); } } }
    }
    const edit = configuration => { if (!busy && !active.current) { setDraft(configuration); draftRef.current = configuration; setError(''); setMessage(''); } };
    const changeApi = (id, patch, persist = false) => {
      if (busy || active.current || !draftRef.current) return Promise.reject(Error(t.error));
      const next = updateApiConfiguration(draftRef.current, id, patch, scope === 'site' ? host : null);
      if (!next.ok) return Promise.reject(Error(configurationError(next.error)));
      if (persist) return commit(next.value);
      edit(next.value); return Promise.resolve();
    };
    const button = (label, onClick, properties = {}) => h('button', { type: 'button', class: 'button', onClick, disabled: busy, children: label, ...properties });
    const labelFor = entry => {
      if (entry.group === 'webassembly') return entry.name;
      const key = 'protection_feature_' + entry.id.replaceAll('-', '_'), translated = translate?.(key);
      return translated && translated !== key ? translated : entry.name;
    };
    if (!draft || !saved) return h('section', { class: 'blocking-settings api-configuration', 'data-protection-settings': true, 'aria-busy': busy, children: [h('p', { role: error ? 'alert' : 'status', children: error || t.loading }), error ? button(t.refresh, () => refresh(true)) : null] });
    const editingSite = scope === 'site', site = draft.sites.find(site => site.host === host), canEdit = panelActive && !busy && (!editingSite || host !== null), dirty = !sameValue(draft, baseRef.current),
      allRows = draft.apis.filter(entry => !hideWebRtc || entry.id !== 'webrtc').filter(entry => presentation !== 'antidetect' || entry.customSupported && !['webrtc', 'media-enumeration', 'websocket', 'webtransport', 'math-transcendentals'].includes(entry.id)).map(entry => editingSite ? { ...entry, ...(site?.apis.find(row => row.id === entry.id) ?? { mode: 'bypass', selected: { kind: 'unset' }, settings: {} }) } : entry),
      query = search.trim().toLocaleLowerCase(), matchingRows = allRows.filter(entry => (!configured || entry.mode !== 'bypass') && (!customOnly || entry.customSupported) && (!filterObserved || observedApiUsage(observedUsage, entry.id) || editingValues.current.has(entry.id)) && (!query || apiSearchText(entry, labelFor(entry), translate).includes(query))),
      rows = matchingRows.filter(entry => modeFilter === 'all' || entry.mode === (modeFilter === 'spoofed' ? 'custom' : 'on')),
      categoryFor = entry => categoryOverrides?.[entry.id] ?? featureFilter[entry.id] ?? (entry.id.startsWith('screen-') || entry.id === 'window-device-pixel-ratio' ? 'hardware' : entry.group === 'system' || entry.id.startsWith('navigator-') || entry.id === 'timezone' ? 'os' : ['device', 'graphics', 'hardware', 'media'].includes(entry.group) ? 'hardware' : entry.group === 'network' ? 'network' : entry.group === 'identity' ? 'social' : 'browser'),
      counts = Object.fromEntries(filters.map(id => [id, rows.filter(entry => id === 'all' || categoryFor(entry) === id).length])),
      categoryLabel = id => { const key = 'protection_filter_' + id, value = translate?.(key); return value && value !== key ? value : (locale === 'ru' ? { hardware: 'Аппаратура', os: 'ОС', network: 'Сеть', browser: 'Браузер', social: 'Соцсети' } : { hardware: 'Hardware', os: 'OS', network: 'Network', browser: 'Browser', social: 'Social' })[id] ?? id; },
      hasWasmChildren = API_CONFIG_CATALOG.some(entry => entry.group === 'webassembly'), groupFor = entry => hasWasmChildren && entry.id === 'webassembly' ? 'webassembly' : entry.group,
      inCategory = entry => (group === 'all' || groupFor(entry) === group) && ((fixedCategory ?? category) === 'all' || categoryFor(entry) === (fixedCategory ?? category)),
      modeCandidates = matchingRows.filter(inCategory), modeCounts = { spoofed: modeCandidates.filter(entry => entry.mode === 'custom').length, blocked: modeCandidates.filter(entry => entry.mode === 'on').length },
      groups = [...new Set(API_CONFIG_CATALOG.map(entry => entry.group))].filter(value => value !== 'webassembly'), shown = rows.filter(inCategory), hosts = [...new Set([...(saved.host ? [saved.host] : []), ...draft.sites.map(site => site.host)])], warnings = apiConfigurationWarnings(draft);
    if (hasWasmChildren) groups.splice(groups.indexOf('browser') + 1, 0, 'webassembly');
    const rtcEntry = allRows.find(entry => entry.id === 'webrtc');
    function openRtcProfile() {
      if (!canEdit || !rtcEntry || active.current) return;
      const value = rtcEntry.userValues.find(value => sameValue(value.value, rtcEntry.selected)) ?? null;
      editingValues.current.add('webrtc-shortcut');
      setRtcDialog({ entry: clone(rtcEntry), value: value ? clone(value) : null, revision: revisionRef.current, host: editingSite ? host : null, epoch: generation.current });
    }
    const closeRtcProfile = () => { editingValues.current.delete('webrtc-shortcut'); setRtcDialog(null); };
    async function saveRtcProfile(next) {
      if (!rtcDialog || rtcDialog.epoch !== generation.current || !baseRef.current || !draftRef.current) throw Error(t.stale);
      const userValues = rtcDialog.value ? rtcDialog.entry.userValues.map(value => value.id === rtcDialog.value.id ? next : value) : [...rtcDialog.entry.userValues, next];
      const patch = { mode: 'custom', selected: clone(next.value), userValues }, persisted = updateApiConfiguration(baseRef.current, 'webrtc', patch, rtcDialog.host), retained = updateApiConfiguration(draftRef.current, 'webrtc', patch, rtcDialog.host);
      if (!persisted.ok || !retained.ok) throw Error(configurationError((!persisted.ok ? persisted : retained).error));
      const source = savedRef.current, reloadTarget = (persisted.value.enabled || persisted.value.antidetectEnabled) && tabId !== null && source?.documentId && (rtcDialog.host === null || rtcDialog.host === source.host) ? { documentId: source.documentId, host: source.host } : null;
      setModeAction({ id: 'webrtc', phase: 'saving', pendingReload: false });
      try { await commit(persisted.value, rtcDialog.revision, reloadTarget !== null, { preserveDraft: retained.value, reloadTarget, modeId: 'webrtc' }); }
      catch (failure) {
        if (mounted.current && rtcDialog.epoch === generation.current) setModeAction({ id: 'webrtc', phase: 'error', pendingReload: false, error: failure.message });
        throw failure;
      }
    }
    const translated = (key, fallback) => { const value = translate?.(key); return value && value !== key ? value : fallback; };
    const groupLabel = value => value === 'webassembly' ? translated('protection_group_webassembly', 'WebAssembly') : t.groups[value] ?? value;
    shownRef.current = shown.length;
    const touchFilter = (setter, value) => { filterTouched.current = true; setter(value); };
    const clearFilters = () => { filterTouched.current = true; setSearch(''); setGroup('all'); setCategory('all'); setModeFilter('all'); setConfigured(false); setCustomOnly(false); changeObservedOnly(false); filterRef.current?.querySelector('[data-protection-filter="all"]')?.focus(); };
    const shownKey = 'protection_filter_shown', translatedShown = announced === null ? '' : translate?.(shownKey, [String(announced), String(API_CONFIG_CATALOG.length)]),
      shownText = announced === null ? '' : translatedShown && translatedShown !== shownKey ? translatedShown : (locale === 'ru' ? 'Показано API: ' : 'APIs shown: ') + announced + ' / ' + API_CONFIG_CATALOG.length;
    function siteChange(patch) {
      if (!canEdit || !host) return;
      const empty = draft.apis.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
      const next = { ...draft, sites: [...draft.sites.filter(site => site.host !== host), { ...(site ?? { host, disabled: false, apis: empty }), ...patch }] }, checked = validateApiConfiguration(next);
      checked.ok ? edit(checked.value) : setError(configurationError(checked.error));
    }
    function addSite() {
      let candidate;
      try { candidate = hostInput.trim().toLowerCase(); if (new URL('https://' + candidate + '/').hostname !== candidate) throw Error(); }
      catch { setError(t.hostError); return; }
      const next = { ...draft, sites: draft.sites.some(site => site.host === candidate) ? draft.sites : [...draft.sites, { host: candidate, disabled: false, apis: draft.apis.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} })) }] }, checked = validateApiConfiguration(next);
      if (!checked.ok) { setError(t.hostError); return; }
      edit(checked.value); setHost(candidate); setHostInput('');
    }
    function renderApiValue(entry) {
      if (!entry.customSupported) return null;
      if (entry.mode === 'custom') return h(CustomValueEditor, {
        entry: { ...entry, name: labelFor(entry) }, disabled: !canEdit || saved.earlyAccess !== 'ready',
        onEditingChange: active => { if (active) editingValues.current.add(entry.id); else editingValues.current.delete(entry.id); },
        onChange: (patch, options) => changeApi(entry.id, patch, options?.persist === true)
      });
      const inherited = editingSite && host !== null && !site?.disabled && entry.mode === 'bypass' ? draft.apis.find(row => row.id === entry.id) : null;
      if (inherited?.mode !== 'custom') return null;
      const value = displayValue(inherited, inherited.selected, locale);
      const inheritedLabel = translated('protection_api_inherited_custom', locale === 'ru' ? 'Наследуется Custom из «Все сайты»' : 'Inherited Custom from All sites');
      return h('p', { class: 'api-config-inherited-value', 'data-api-inherited-value': entry.id, children: [inheritedLabel + ': ', h('code', { dir: 'ltr', title: value, children: value })] });
    }
    function changeMaster() {
      if (busy || active.current || !baseRef.current || !draftRef.current) return;
      // ADR-072: a master action commits its own field and retains unrelated drafts.
      const enabled = !baseRef.current.enabled;
      void commit({ ...baseRef.current, enabled }, revisionRef.current, false, { preserveDraft: { ...draftRef.current, enabled } }).catch(() => {});
    }
    function changeMode(entry, mode) {
      if (busy || active.current || !baseRef.current || !draftRef.current || !canEdit) return;
      const patch = { mode };
      if (mode === 'custom') patch.selected = entry.selected.kind === 'unset' ? entry.userValues[0]?.value ?? entry.presets[0]?.value ?? { kind: 'unset' } : entry.selected;
      const targetHost = editingSite ? host : null, persisted = updateApiConfiguration(baseRef.current, entry.id, patch, targetHost), retained = updateApiConfiguration(draftRef.current, entry.id, patch, targetHost);
      if (!persisted.ok || !retained.ok) { const error = configurationError((!persisted.ok ? persisted : retained).error); setError(error); setModeAction({ id: entry.id, phase: 'error', pendingReload: false, error }); return; }
      const source = savedRef.current, reloadTarget = (persisted.value.enabled || persisted.value.antidetectEnabled) && tabId !== null && source?.documentId && (!editingSite || targetHost === source.host) ? { documentId: source.documentId, host: source.host } : null;
      const focus = globalThis.document?.activeElement, focusRow = focus?.closest?.('[data-protection-feature]'), restoreFocus = focusRow?.getAttribute('data-protection-feature') === entry.id && editorRef.current?.contains(focus);
      const leavingFilter = modeFilter !== 'all' && mode !== (modeFilter === 'spoofed' ? 'custom' : 'on');
      const epoch = generation.current;
      const restoreRadioFocus = () => {
        if (!restoreFocus) return;
        queueMicrotask(() => {
          if (!mounted.current || epoch !== generation.current || active.current || scopeRef.current !== scope || editingSite && hostRef.current !== targetHost) return;
          const selectedMode = (editingSite ? draftRef.current?.sites.find(site => site.host === targetHost)?.apis : draftRef.current?.apis)?.find(row => row.id === entry.id)?.mode ?? 'bypass';
          const row = editorRef.current?.querySelector('[data-protection-feature="' + entry.id + '"]'), button = row?.querySelector('[data-protection-state="' + selectedMode + '"]'), currentFocus = globalThis.document?.activeElement;
          if (row?.getClientRects().length && button && !button.disabled && (currentFocus === globalThis.document?.body || currentFocus === focus || currentFocus === button)) button.focus({ preventScroll: true });
        });
      };
      setModeAction({ id: entry.id, phase: 'saving', pendingReload: false });
      void commit(persisted.value, revisionRef.current, reloadTarget !== null, { preserveDraft: retained.value, reloadTarget, modeId: entry.id }).then(() => {
        if (leavingFilter) {
          const currentFocus = globalThis.document?.activeElement, chip = modeFilterRef.current?.querySelector('[data-api-mode-filter="' + modeFilter + '"]');
          if (restoreFocus && mounted.current && epoch === generation.current && scopeRef.current === scope && (!editingSite || hostRef.current === targetHost) && (currentFocus === globalThis.document?.body || currentFocus === focus) && chip?.getClientRects().length) chip.focus();
        }
        else restoreRadioFocus();
      }).catch(failure => { if (mounted.current && epoch === generation.current) { setError(failure.message); setModeAction({ id: entry.id, phase: 'error', pendingReload: false, error: failure.message }); restoreRadioFocus(); } });
    }
    const pendingReload = saved.registration !== 'error' && saved.reloadRequired && reloadedRevision.current !== saved.revision;
    const modeGlobal = saved.configuration.apis.find(row => row.id === modeAction?.id);
    const modeLocal = editingSite ? saved.configuration.sites.find(site => site.host === host)?.apis.find(row => row.id === modeAction?.id) : null;
    const modeCustom = (modeLocal && modeLocal.mode !== 'bypass' ? modeLocal : modeGlobal)?.mode === 'custom';
    const modeMaster = modeCustom ? saved.configuration.antidetectEnabled : saved.configuration.enabled;
    const modeInactive = modeCustom ? 'Antidetect · OFF' : t.inactive;
    const modeNotice = modeAction?.phase === 'saving' ? translated('protection_api_mode_saving', locale === 'ru' ? 'Сохраняем режим API…' : 'Saving API mode…') : modeAction?.phase === 'error' ? modeAction.error : modeAction && !modeMaster ? t.configSaved + '. ' + modeInactive : modeAction?.pendingReload || pendingReload ? translated('protection_api_mode_saved_reload', locale === 'ru' ? 'Режим сохранён. Перезагрузите уже открытые страницы, чтобы применить его.' : 'Mode saved. Reload already open pages to apply it.') : modeAction ? t.configSaved : null;
    // ADR-103: the pill restates the effective state from the current draft; it never writes.
    const listText = apiGuardLabels(locale), modeText = redesignLabels(locale);
    function effectiveState(entry) {
      if (editingSite && site?.disabled) return { state: 'off', inherited: false, dormant: true, note: t.inactive };
      const inherited = editingSite && entry.mode === 'bypass' ? draft.apis.find(row => row.id === entry.id) : null, state = inherited && inherited.mode !== 'bypass' ? inherited.mode : entry.mode;
      const master = state === 'custom' ? draft.antidetectEnabled : draft.enabled, dormant = state !== 'off' && !master;
      return { state, inherited: state !== entry.mode, dormant, note: dormant ? (state === 'custom' ? 'Antidetect · OFF' : t.inactive) : null };
    }
    function renderState(entry) {
      const effective = effectiveState(entry), name = { bypass: 'inherit', off: 'allowed', on: 'blocked', custom: 'custom' }[effective.state] ?? 'inherit';
      const label = { inherit: modeText.modeInherit, allowed: listText.stateAllowed, blocked: listText.stateBlocked, custom: modeText.modeCustom }[name];
      const details = [effective.inherited ? t.inherited + ' · ' + t.global : null, effective.note].filter(Boolean).join(' · ');
      return h('span', { class: 'api-config-state api-config-state--' + name + (effective.inherited ? ' is-inherited' : '') + (effective.dormant ? ' is-dormant' : ''), title: listText.effective + ': ' + label + (details ? ' · ' + details : ''), 'data-api-effective-state': name, 'data-api-effective-inherited': effective.inherited ? 'true' : undefined, 'data-api-effective-dormant': effective.dormant ? 'true' : undefined, children: [
        h('span', { class: 'api-config-state__dot', 'aria-hidden': true }), h('span', { children: label }), details ? h('span', { class: 'sr-only', children: ' · ' + details }) : null] });
    }
    function renderRule(entry) {
      return h('div', { class: 'blocking-rule api-config-rule' + observedApiClass(observedUsage, entry.id), ...observedApiAttributes(observedUsage, entry.id), 'data-protection-feature': entry.id, key: entry.id, children: [h('div', { class: 'api-config-rule__header', children: [h('div', { class: 'api-config-rule__description', children: [h('strong', { class: 'blocking-rule__name', dir: entry.group === 'webassembly' ? 'ltr' : undefined, children: labelFor(entry) }), h('span', { class: 'api-config-rule__meta', children: [h('code', { class: 'api-config-rule__id', dir: 'ltr', children: entry.id }), h('span', { class: 'api-config-rule__category', children: categoryLabel(categoryFor(entry)) })] }), h(UsageBadge, { usage: observedUsage, apiId: entry.id })] }), h('div', { class: 'api-config-rule__controls', children: [renderState(entry), h(ModeControl, { entry, label: labelFor(entry), earlyAccess: saved.earlyAccess, disabled: !canEdit, onChange: mode => changeMode(entry, mode) })] })] }),
        entry.id === 'webrtc' && presentation !== 'antidetect' ? h('div', { class: 'api-config-webrtc-shortcut', ref: rtcShortcutRef, children: [h('span', { class: 'api-config-caption', children: webRtcText(translate, 'profile_addresses') }), h('button', { type: 'button', class: 'button', disabled: !canEdit, 'data-webrtc-row-configure': true, 'aria-haspopup': 'dialog', onClick: openRtcProfile, children: webRtcText(translate, 'profile_configure') })] }) : null,
        renderApiValue(entry), modeAction?.id === entry.id ? h('p', { class: 'api-config-row-status', role: modeAction.phase === 'error' ? 'alert' : 'status', 'data-api-row-status': entry.id, children: modeNotice }) : null] });
    }
    const chevron = () => h('svg', { class: 'api-config-group-toggle__icon', viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true, focusable: 'false', children: h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) });
    function renderGroup(value) {
      const entries = shown.filter(entry => groupFor(entry) === value);
      if (value !== 'webassembly') {
        const open = !collapsedGroups.includes(value), bodyId = wasmGroupId.current + '-group-' + value;
        return h('section', { class: 'blocking-group blocking-group--' + value + ' api-config-group' + (open ? '' : ' is-collapsed'), 'data-protection-group': value, key: value, children: [
          h('h2', { class: 'blocking-group__heading', children: h('button', { type: 'button', class: 'api-config-group-toggle', 'data-api-group-toggle': value, 'aria-expanded': open, 'aria-controls': bodyId, title: open ? listText.collapse : listText.expand, onClick: () => setCollapsedGroups(previous => previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value]), children: [renderGroupIcon(value), chevron(), h('span', { class: 'api-config-group__label', children: groupLabel(value) }), h('span', { class: 'blocking-group__count', children: entries.length })] }) }),
          h('div', { class: 'blocking-rules', id: bodyId, hidden: !open, inert: !open, children: entries.map(renderRule) })
        ] });
      }
      const children = entries.filter(entry => entry.id !== 'webassembly'), parent = entries.find(entry => entry.id === 'webassembly'), action = translated(wasmExpanded ? 'protection_webassembly_collapse' : 'protection_webassembly_expand', locale === 'ru' ? (wasmExpanded ? 'Скрыть функции' : 'Показать функции') : (wasmExpanded ? 'Hide functions' : 'Show functions'));
      return h('section', { class: 'blocking-group blocking-group--webassembly api-config-wasm-group', 'data-protection-group': value, key: value, children: [
        h('h2', { class: 'blocking-group__heading', children: h('button', { type: 'button', class: 'api-config-group-toggle', 'data-api-wasm-toggle': true, 'aria-expanded': wasmExpanded, 'aria-controls': wasmGroupId.current, 'aria-label': action + ' — WebAssembly', ref: wasmToggleRef, disabled: children.length === 0, onClick: () => { if (wasmExpanded && wasmChildrenRef.current?.contains(globalThis.document?.activeElement)) wasmToggleRef.current?.focus(); setWasmExpanded(value => !value); }, children: [renderGroupIcon(value), chevron(), h('span', { class: 'api-config-group__label', dir: 'ltr', children: groupLabel(value) }), h('span', { class: 'api-config-group-toggle__action', children: action }), h('span', { class: 'blocking-group__count', children: entries.length })] }) }),
        h('div', { class: 'blocking-rules', children: [parent ? renderRule(parent) : null, h('div', { class: 'api-config-wasm-children', id: wasmGroupId.current, hidden: !wasmExpanded, inert: !wasmExpanded, ref: wasmChildrenRef, 'data-api-wasm-children': true, 'data-api-wasm-count': children.length, children: children.map(renderRule) })] })
      ] });
    }
    const save = reload => { void commit(draftRef.current, revisionRef.current, reload).catch(() => {}); };
    const collapsibleGroups = groups.filter(value => value !== 'webassembly' && shown.some(entry => groupFor(entry) === value)), allCollapsed = collapsibleGroups.length > 0 && collapsibleGroups.every(value => collapsedGroups.includes(value));
    return h('section', { class: 'blocking-settings api-configuration', ref: editorRef, 'data-protection-settings': true, 'data-api-configuration-editor': true, 'aria-busy': busy, children: [
      presentation !== 'antidetect' ? WorkspaceMaster({ id: 'api', label: 'API Guard', busy, control: h('button', { type: 'button', class: 'blocking-master ' + (draft.enabled ? 'blocking-master--on' : 'blocking-master--off'), role: 'switch', 'aria-checked': draft.enabled, 'aria-label': 'API Guard', disabled: busy, 'data-protection-master': true, 'data-protection-action': 'master', onClick: changeMaster, children: [h('span', { class: 'blocking-master__dot', 'aria-hidden': true }), h('span', { children: draft.enabled ? 'ON' : 'OFF' })] }) }) : null,
      h(EarlyAccessNotice, { access: saved.earlyAccess, onRefresh: () => refresh(false) }),
      h('div', { class: 'api-config-toolbar', role: 'group', 'aria-label': listText.toolbar, 'data-api-config-toolbar': true, children: [
        h('div', { class: 'api-config-heading api-config-toolbar__top', children: [h('div', { children: [h('strong', { children: t.title }), h('p', { class: 'api-config-caption', children: API_CONFIG_CATALOG.length + ' API · ' + t.format + ' ' + draft.formatVersion })] }), h(ApiConfigurationTransfer, { configuration: draft, savedConfiguration: baseRef.current, revision: revisionRef.current, disabled: busy, onCommit: (next, expected) => commit(next, expected) })] }),
        h('div', { class: 'blocking-controls api-config-toolbar__settings', children: [
          global ? h('div', { class: 'blocking-control', children: [h('span', { class: 'blocking-control__label', children: t.scope }), h('div', { class: 'blocking-segmented', role: 'radiogroup', 'aria-label': t.scope, children: ['global', 'site'].map(value => h('button', { type: 'button', role: 'radio', 'aria-checked': scope === value, class: 'blocking-segmented__option' + (scope === value ? ' is-selected' : ''), disabled: busy, 'data-protection-scope': value, onClick: () => setScope(value), children: value === 'global' ? t.global : t.site, key: value })) })] }) : null,
          h('label', { class: 'blocking-control', children: [h('span', { class: 'blocking-control__label', children: t.preset }), h('select', { value: draft.preset, class: 'api-config-select', disabled: busy, 'data-protection-preset-select': true, onChange: event => edit({ ...draft, preset: event.currentTarget.value }), children: ['custom', 'limited', 'strict'].map(value => h('option', { value, children: t[value], key: value })) })] }),
          editingSite ? h('div', { class: 'blocking-site-controls', children: [
            h('label', { class: 'blocking-host-picker', children: [h('span', { children: t.site }), h('select', { value: host ?? '', disabled: busy, 'data-protection-host-picker': true, onChange: event => setHost(event.currentTarget.value || null), children: [h('option', { value: '', children: t.noHost }), ...hosts.map(value => h('option', { value, key: value, children: value }))] })] }),
            h('div', { class: 'blocking-host-entry', children: [h('input', { type: 'text', inputMode: 'url', dir: 'ltr', maxLength: 253, value: hostInput, disabled: busy, placeholder: 'example.com', 'aria-label': t.site, 'data-protection-host': true, onInput: event => setHostInput(event.currentTarget.value), onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); addSite(); } } }), button(t.addSite, addSite, { disabled: busy || !hostInput.trim() })] }),
            h('div', { class: 'blocking-site-actions', children: [h('label', { class: 'blocking-checkbox', children: [h('input', { type: 'checkbox', checked: site?.disabled ?? false, disabled: !canEdit, onChange: event => siteChange({ disabled: event.currentTarget.checked }) }), t.siteOff] }), site ? button(t.removeSite, () => edit({ ...draft, sites: draft.sites.filter(site => site.host !== host) })) : null] })
          ] }) : null
        ] }),
        h('div', { class: 'blocking-filter api-config-filter', children: [h('span', { class: 'api-config-search', children: [h('svg', { class: 'api-config-search__icon', viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true, focusable: 'false', children: [h('circle', { cx: 7, cy: 7, r: 4.5, stroke: 'currentColor', 'stroke-width': 1.6 }), h('path', { d: 'm10.5 10.5 3 3', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' })] }), h('input', { type: 'search', value: search, 'aria-label': t.searchApis, placeholder: t.searchApis, 'data-protection-search': true, onInput: event => touchFilter(setSearch, event.currentTarget.value) })] }), h('label', { class: 'api-config-group-picker', children: [h('span', { class: 'sr-only', children: t.allGroups }), h('select', { class: 'api-config-select', value: group, 'data-api-group-picker': true, onChange: event => touchFilter(setGroup, event.currentTarget.value), children: [h('option', { value: 'all', children: t.allGroups }), ...groups.map(value => h('option', { value, key: value, children: groupLabel(value) }))] })] }), h('label', { class: 'blocking-checkbox api-config-toggle', children: [h('input', { type: 'checkbox', checked: configured, onChange: event => touchFilter(setConfigured, event.currentTarget.checked) }), t.configured] }), h('label', { class: 'blocking-checkbox api-config-toggle', children: [h('input', { type: 'checkbox', checked: customOnly, onChange: event => touchFilter(setCustomOnly, event.currentTarget.checked) }), t.customOnly] }), h('button', { type: 'button', class: 'button button--text api-config-collapse-all', 'data-api-groups-collapse': allCollapsed ? 'expand' : 'collapse', disabled: collapsibleGroups.length === 0, onClick: () => setCollapsedGroups(allCollapsed ? [] : collapsibleGroups), children: allCollapsed ? listText.expandAll : listText.collapseAll })] }),
        h('div', { class: 'api-config-filter-groups', children: [presentation !== 'antidetect' ? h(CategoryFilters, { value: category, counts, focusRef: filterRef, onChange: value => touchFilter(setCategory, value) }) : null, h(ModeFilters, { value: modeFilter, counts: modeCounts, focusRef: modeFilterRef, onChange: value => touchFilter(setModeFilter, value) })] })
      ] }),
      h('span', { class: 'sr-only', role: 'status', 'data-protection-filter-live': true, children: shownText }),
      !hideUsageContext ? h(UsageContext, { usage: observedUsage, filtered: usageOnly, onFilterChange: changeObservedOnly }) : null,
      rtcDialog ? h(ValueModal, { key: 'webrtc-shortcut', entry: rtcDialog.entry, value: rtcDialog.value, initialValue: { label: webRtcText(translate, 'profile_title'), value: rtcDialog.entry.selected.kind === 'value' ? rtcDialog.entry.selected : rtcDialog.entry.presets[0].value }, title: webRtcText(translate, 'profile_title'), submitLabel: webRtcText(translate, 'profile_save'), returnFocus: rtcShortcutRef, onSave: saveRtcProfile, onClose: closeRtcProfile }) : null,
      modeNotice ? h('div', { class: 'api-config-apply-status', role: modeAction?.phase === 'error' ? 'alert' : 'status', 'data-api-mode-status': true, children: modeNotice }) : null,
      h('div', { class: 'blocking-groups', children: groups.filter(value => shown.some(entry => groupFor(entry) === value)).map(renderGroup) }),
      shown.length === 0 ? h('div', { class: 'blocking-empty', 'data-protection-empty': true, children: [h('p', { class: 'blocking-message', role: 'status', children: t.noApis }), button(translate?.('protection_filter_clear') || (locale === 'ru' ? 'Сбросить фильтры' : 'Clear filters'), clearFilters, { 'data-protection-filter-clear': true })] }) : null,
      warnings.length ? h('ul', { class: 'api-config-warnings', children: warnings.map((warning, index) => h('li', { key: warning.code + ':' + warning.scope + ':' + index, children: warning.scope + ': ' + warning.message })) }) : null,
      h('div', { class: 'blocking-footer', children: [
        pendingReload ? h('p', { class: 'blocking-message', 'data-api-config-reload': true, children: t.reload }) : null,
        h('p', { class: 'blocking-message' + (error || saved.registration === 'error' ? ' blocking-message--error' : ''), role: error || saved.registration === 'error' ? 'alert' : 'status', 'data-protection-status': true, children: error || (saved.registration === 'error' ? t.activationFailed : dirty ? t.draft : message || (presentation === 'antidetect' ? 'Antidetect · ' + (saved.configuration.antidetectEnabled ? 'ON' : 'OFF') : 'API Guard · ' + (saved.configuration.enabled ? 'ON' : 'OFF'))) }),
        h('div', { class: 'blocking-actions', children: [button(t.saveConfig, () => save(false), { class: 'button button--primary', disabled: busy || !dirty, 'data-protection-save': true, 'data-protection-action': 'save' }), tabId !== null ? button(t.saveReload, () => save(true), { disabled: busy || !saved.documentId, 'data-protection-save-reload': true }) : null, button(t.discard, () => { edit(saved.configuration); baseRef.current = saved.configuration; revisionRef.current = saved.revision; }, { disabled: busy || !dirty }), button(t.refresh, () => refresh(true), { 'data-api-config-refresh': true }), button(t.reset, () => { const next = clone(draft); if (editingSite) { if (site) next.sites = next.sites.map(value => value.host === host ? { ...value, apis: value.apis.map(row => ({ ...row, mode: 'bypass', selected: { kind: 'unset' }, settings: {} })) } : value); } else next.apis = next.apis.map(row => ({ ...row, mode: 'bypass', selected: { kind: 'unset' }, settings: {} })); edit(next); }, { disabled: !canEdit, 'data-protection-reset': true })] })
      ] })
    ] });
  }
  return { ApiConfigurationEditor, CustomValueEditor, ValueModal, ApiConfigurationTransfer, Modal, ModeControl, CategoryFilters, ModeFilters, EarlyAccessNotice, WebRtcProfileFields, WebRtcNetworkPolicyPanel, MediaCodecFields, catalog: API_CONFIG_CATALOG, validateConfiguration: validateApiConfiguration };
}
