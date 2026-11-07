// Locale contract for the UI: every key the components/view models reference exists in ru and en, placeholders
// match, and docs/ui-copy.md §8 forbidden wording never appears (REQ-007, REQ-014, REQ-015).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_CONFIDENCES,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  COVERAGE_STATES,
  EMPTY_DROPPED,
  EVIDENCE_SOURCES,
  HOST_CATEGORIES,
  INTEGRITIES,
  INTERPRETATION_CONFIDENCES,
  PHASES,
  SCOPE_MODES,
  SENSOR_IDS,
  SIGNAL_CODES,
  SITE_RELATIONS,
  UI_ERROR_CODES,
  VENDOR_MATCHES,
} from '@detect-expert/contracts';
import { STATUS_KEYS, coverageFlagKey } from '../src/view-models/coverage';
import { SCOPE_MODE_LABEL_KEYS, SCOPE_OPTIONS } from '../src/view-models/scope';
import { categoryKey } from '../src/view-models/techniques';
import { confidenceKey, vendorMatchKey } from '../src/view-models/cards';
import { hostCategoryKey, relationKey } from '../src/view-models/sources';
import { sensorDescKey, sensorNameKey } from '../src/view-models/sensors';
import { errorMessageKey } from '../src/messaging';
import { exportAvailability } from '../src/view-models/export';
import { report as fixtureReport } from './fixtures';
import { ALL_LIMITATION_CODES, ALL_COUNTER_EVIDENCE_CODES } from '../../engine/src/codes';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', '..', '..', 'apps', 'extension', '_locales');
const srcDir = join(here, '..', 'src');

it('F080–F082/F088/F089 contextual wording and documentation match the shipped locales', () => {
  const docs = readFileSync(join(here, '../../../docs/ui-copy.md'), 'utf8');
  for (const locale of ['ru', 'en']) {
    const table = load(locale);
    for (const key of ['action_pause', 'card_api_use_canvas_text', 'coverage_degraded_desc', 'onboarding_limits', 'aria_live_update', 'export_include_host', 'coverage_sensor_disabled_desc', 'card_vendor_first_party']) {
      expect(table[key]?.message).toBeTruthy();
      expect(docs).toContain(table[key]!.message);
      expect(table[key]!.message).not.toMatch(/\?{3}/);
    }
    expect(table['action_pause']!.message).toContain(locale === 'ru' ? 'документе' : 'document');
    expect(table['card_api_use_canvas_text']!.message).toContain(locale === 'ru' ? 'измерения' : 'measurement');
  }
});

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

function load(locale: string): Table {
  return JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8')) as Table;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
}

const FORBIDDEN_RU = [
  'сайт безопасен',
  'сайт чист',
  'легитимн',
  'утечка доказана',
  'утечки нет',
  'сайт украл',
  'аудио прослушивается',
  'dns утёк',
  'ваш процессор определён',
  'защищает от утечек',
  'определяет все трекеры',
  'доказывает мошенничество',
  'невидимо для сайта',
  'проверено 100',
  '100 %',
  '100%',
  'зашифрован',
  'анонимизирован',
];

const FORBIDDEN_EN = [
  'site is safe',
  'site is clean',
  'legitimate',
  'leak proven',
  'no leak',
  'stole your fingerprint',
  'audio is being listened',
  'dns leaked',
  'your cpu is identified',
  'protects against leaks',
  'detects all trackers',
  'proves fraud',
  'invisible to the site',
  '100 %',
  '100%',
  'encrypted',
  'anonymized',
  'anonymised',
];

describe('_locales contract for packages/ui', () => {
  const ru = load('ru');
  const en = load('en');

  it('ru and en have identical keys and placeholder sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const key of Object.keys(ru)) {
      const a = Object.keys(ru[key]?.placeholders ?? {}).sort();
      const b = Object.keys(en[key]?.placeholders ?? {}).sort();
      expect(b, key).toEqual(a);
    }
  });

  it('every $NAME$ used in a message has a placeholder with a positional content', () => {
    for (const [locale, table] of [
      ['ru', ru],
      ['en', en],
    ] as const) {
      for (const [key, entry] of Object.entries(table)) {
        const used = [...entry.message.matchAll(/\$([A-Za-z_]+)\$/g)].map((m) => m[1]!.toLowerCase());
        const declared = Object.keys(entry.placeholders ?? {}).map((p) => p.toLowerCase());
        expect(used.sort(), locale + ':' + key).toEqual([...new Set(declared)].sort());
        for (const placeholder of Object.values(entry.placeholders ?? {})) expect(placeholder.content, locale + ':' + key).toMatch(/^\$[1-9]$/);
      }
    }
  });

  it('never contains the forbidden claims of docs/ui-copy.md §8', () => {
    for (const [table, forbidden] of [
      [ru, FORBIDDEN_RU],
      [en, FORBIDDEN_EN],
    ] as const) {
      for (const [key, entry] of Object.entries(table)) {
        const text = entry.message.toLowerCase();
        for (const phrase of forbidden) expect(text.includes(phrase), key + ' contains "' + phrase + '"').toBe(false);
      }
    }
  });

  it('keeps the mandatory wording of the spec', () => {
    expect(ru['vendorsSectionTitle']?.message).toBe('Распознанные сервисы защиты и идентификации');
    expect(ru['coverage_paused_desc']?.message).toBe('Наблюдение приостановлено. Страница продолжает работу.');
    expect(ru['empty_no_findings']?.message).toBe('За этот период в доступной области находок нет');
    expect(ru['action_reload']?.message).toBe('Перезагрузить для анализа с начала');
    expect(ru['card_fp_math_sequence']?.message).toBe('Серия численных проверок похожа на известный шаблон');
    expect(ru['coverage_unsupported_title']?.message).toBe('На этой странице наблюдение недоступно');
    expect(ru['onboarding_no_server']?.message).toBe('Расширение не отправляет результаты анализа и не обращается к серверам разработчика.');
    expect(ru['card_vendor_found']?.message).toBe('Найдены признаки интеграции $VENDOR$');
    expect(ru['card_vendor_threatmetrix_purpose']?.message).toBe('оценка риска и цифровой идентичности');
  });

  it('every literal key referenced from packages/ui/src exists', () => {
    const files: string[] = [];
    walk(srcDir, files);
    const referenced = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Only complete literal keys: `t('key')` / `t('key', …)`; prefixes like `t('tab_' + id)` are covered by the family test.
      for (const match of text.matchAll(/\bt(?:Optional)?\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*[,)]/g)) referenced.add(match[1]!);
      for (const match of text.matchAll(/\bmsg\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*[,)]/g)) referenced.add(match[1]!);
      for (const match of text.matchAll(/(?:key|labelKey|descKey|titleKey|statusKey|emptyKey)\s*:\s*'([A-Za-z][A-Za-z0-9_]*)'/g)) referenced.add(match[1]!);
    }
    expect(referenced.size).toBeGreaterThan(60);
    const missing = [...referenced].filter((key) => ru[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('every dynamically derived key family exists', () => {
    const keys: string[] = [];
    for (const code of ALL_LIMITATION_CODES) keys.push('limitation_' + code.replace(/-/g, '_'));
    for (const code of ALL_COUNTER_EVIDENCE_CODES) keys.push('alternative_' + code.replace(/-/g, '_'));
    for (const flag of COVERAGE_FLAGS) keys.push(coverageFlagKey(flag));
    for (const state of COVERAGE_STATES) keys.push(STATUS_KEYS[state]);
    for (const phase of PHASES) keys.push('phase_' + phase.replace(/-/g, '_'));
    for (const source of EVIDENCE_SOURCES) keys.push('evidence_' + source.replace(/-/g, '_'));
    for (const integrity of INTEGRITIES) keys.push('integrity_' + integrity.replace(/-/g, '_'));
    for (const attribution of ATTRIBUTION_CONFIDENCES) keys.push('attribution_' + attribution.replace(/-/g, '_'));
    for (const quality of COUNT_QUALITIES) keys.push('count_' + quality.replace(/-/g, '_'));
    for (const confidence of INTERPRETATION_CONFIDENCES) keys.push(confidenceKey(confidence));
    for (const match of VENDOR_MATCHES) keys.push(vendorMatchKey(match));
    for (const code of UI_ERROR_CODES) keys.push(errorMessageKey(code));
    keys.push(errorMessageKey('unavailable'));
    for (const mode of SCOPE_MODES) keys.push(SCOPE_MODE_LABEL_KEYS[mode]);
    for (const option of SCOPE_OPTIONS) keys.push(option.labelKey, option.descKey);
    for (const category of ['graphics', 'audio', 'environment', 'permissions', 'storage', 'network'] as const) keys.push(categoryKey(category));
    for (const key of Object.keys(EMPTY_DROPPED)) keys.push('dropped_' + key);
    for (const tab of ['overview', 'techniques', 'sources', 'limits']) keys.push('tab_' + tab);
    const missing = keys.filter((key) => ru[key] === undefined || en[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('S11: sensor_name_* and sensor_desc_* families follow SENSOR_IDS exactly; sensor texts carry their DET ids', () => {
    const names = SENSOR_IDS.map(sensorNameKey);
    const descs = SENSOR_IDS.map(sensorDescKey);
    for (const table of [ru, en]) {
      expect(names.filter((key) => table[key] === undefined)).toEqual([]);
      expect(descs.filter((key) => table[key] === undefined)).toEqual([]);
      expect(Object.keys(table).filter((key) => key.startsWith('sensor_name_')).sort()).toEqual([...names].sort());
      expect(Object.keys(table).filter((key) => key.startsWith('sensor_desc_')).sort()).toEqual([...descs].sort());
      for (const key of descs) expect(table[key]!.message).toMatch(/DET-\d{3}/);
      for (const key of ['sensor_disabled_reason_user', 'sensor_disabled_reason_organization', 'sensor_disabled_reason_both', 'coverage_flag_sensor_disabled',
        'coverage_sensor_disabled_reload', 'options_sensors_title', 'options_sensors_desc', 'options_sensor_state_on', 'options_sensor_state_off_user',
        'options_sensor_state_off_org', 'options_sensors_org_policy', 'options_sensors_policy_lkg', 'options_sensors_applied']) expect(table[key]?.message).toBeTruthy();
    }
    expect(ru['coverage_sensor_reenabled_reload']?.placeholders).toEqual({ sensor: { content: '$1' } });
    expect(ru['options_sensors_policy_rejected']?.placeholders).toEqual({ count: { content: '$1' } });
    expect(ru['coverage_flag_sensor_disabled']?.message).toBe('часть датчиков отключена');
    expect(en['coverage_flag_sensor_disabled']?.message).toBe('some sensors are disabled');
  });

  it('S13: signal_* follows SIGNAL_CODES exactly; filter, timeline, confirmation and export keys exist with their placeholders', () => {
    const signals = SIGNAL_CODES.map((code) => 'signal_' + code.replace(/-/g, '_'));
    const reasons = [exportAvailability(null), exportAvailability(fixtureReport({ coverageState: 'no-access' })), exportAvailability(fixtureReport({ coverageState: 'unsupported' }))];
    expect(reasons).toEqual(['export_unavailable', 'export_unavailable_no_access', 'export_unavailable_unsupported']);
    const fixed = [
      ...reasons,
      'confirm_clear_title', 'confirm_clear_desc', 'confirm_clear_action', 'confirm_clear_session_title', 'confirm_clear_session_desc', 'confirm_clear_session_action',
      'filters_title', 'filter_kind', 'filter_confidence', 'filter_all', 'filter_option_count', 'filter_reset', 'filter_summary', 'filter_empty',
      'group_by', 'group_by_category', 'group_by_kind', 'timeline_title', 'timeline_desc', 'timeline_late_start', 'timeline_row',
      'time_offset_under_second', 'time_offset_seconds', 'time_offset_minutes', 'time_offset_over_day',
      'detail_activity', 'detail_activity_value', 'detail_signals', 'detail_document', 'detail_document_top',
    ];
    for (const table of [ru, en]) {
      expect(signals.filter((key) => table[key] === undefined)).toEqual([]);
      expect(Object.keys(table).filter((key) => key.startsWith('signal_')).sort()).toEqual([...signals].sort());
      expect(fixed.filter((key) => !table[key]?.message)).toEqual([]);
    }
    const placeholders: Record<string, string[]> = {
      confirm_clear_desc: ['host'], filter_option_count: ['label', 'n'], filter_summary: ['shown', 'total'],
      timeline_row: ['technique', 'first', 'last'], time_offset_seconds: ['n'], time_offset_minutes: ['n'], detail_activity_value: ['first', 'last'],
    };
    for (const table of [ru, en]) {
      for (const [key, names] of Object.entries(placeholders)) {
        expect(table[key]?.placeholders, key).toEqual(Object.fromEntries(names.map((name, i) => [name, { content: '$' + String(i + 1) }])));
      }
    }
    expect(ru['confirm_clear_title']?.message).toBe('Удалить отчёт этого документа?');
    expect(en['confirm_clear_title']?.message).toBe("Delete this document's report?");
    expect(ru['filter_summary']?.message).toBe('Показано $SHOWN$ из $TOTAL$');
    expect(ru['timeline_title']?.message).toBe('Хронология активности (приблизительно)');
    // The timeline and the signals row say where the data comes from (page context, may be forged).
    expect(ru['timeline_desc']?.message).toContain('могут быть подделаны');
    expect(en['timeline_desc']?.message).toContain('can be forged');
    expect(ru['detail_signals']?.message).toContain('из контекста страницы');
  });

  it('S08: host_category_* and relation_* families are generated from the contract enums, nothing extra', () => {
    const categories = HOST_CATEGORIES.map(hostCategoryKey);
    const relations = SITE_RELATIONS.map(relationKey);
    for (const table of [ru, en]) {
      expect(categories.filter((key) => table[key] === undefined)).toEqual([]);
      expect(relations.filter((key) => table[key] === undefined)).toEqual([]);
      expect(Object.keys(table).filter((key) => key.startsWith('host_category_')).sort()).toEqual([...categories].sort());
      expect(Object.keys(table).filter((key) => key.startsWith('relation_')).sort()).toEqual([...relations].sort());
    }
    expect(ru['sources_registered']?.placeholders).toEqual({ host: { content: '$1' }, n: { content: '$2' } });
    expect(ru['sources_dropped']?.placeholders).toEqual({ n: { content: '$1' } });
    expect(ru['counts_unavailable']?.message).toBe('нет данных');
    expect(en['counts_unavailable']?.message).toBe('no data');
    expect(ru['sources_none']?.message).toBe('Сетевые события для этого документа не получены.');
    expect(ru['sources_not_owner']?.message).toContain('не указывает владельца');
  });
});
