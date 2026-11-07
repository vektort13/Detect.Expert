import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { announcementFor } from '../../../packages/ui/src/view-models/announce';
import { msg, resolveMessage } from '../../../packages/ui/src/view-models/message';
import { finding, report } from '../../../packages/ui/test/fixtures';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '_locales');

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

function load(locale: string): Table {
  return JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8')) as Table;
}

describe('_locales', () => {
  const ru = load('ru');
  const en = load('en');

  it('F080 / REQ-011 describes observation loss without limiting the flag to attribution', () => {
    expect(ru['coverage_flag_budget_exceeded']?.message).toMatch(/лимит данных наблюдения документа.*не сохранена/);
    expect(en['coverage_flag_budget_exceeded']?.message).toMatch(/document observation data limit.*not retained/);
    for (const table of [ru, en]) expect(table['coverage_flag_budget_exceeded']?.message).not.toMatch(/Math|атрибуц|attribution/i);
  });

  it('F081 / REQ-014 discloses wrappers, detectability and overhead without a size promise', () => {
    expect(ru['onboarding_limits']?.message).toMatch(/не изменяет их результаты.*не блокирует.*обёртками.*замечено сайтом.*добавляет время выполнения/);
    expect(en['onboarding_limits']?.message).toMatch(/without changing their results or blocking.*wrappers.*site can notice.*adds execution time/);
    expect(ru['onboarding_limits']?.message).not.toMatch(/не вмешивается|небольш|незамет/);
    expect(en['onboarding_limits']?.message).not.toMatch(/does not interfere|small|minimal|negligible/);
  });

  it('F082 uses clear API wording, translated redaction and one parenthesis level', () => {
    expect(ru['card_api_use_generic_note']?.message).toContain('— обычное дело и не доказывает слежку');
    expect(ru['export_preview_desc']?.message).toContain('с удалёнными чувствительными данными');
    expect(ru['export_preview_desc']?.message).not.toContain('redacted');
    for (const table of [ru, en]) expect(table['count_lower_bound']?.message).not.toMatch(/[()]/);
  });

  for (const [locale, table] of [['ru', ru], ['en', en]] as const) {
    for (const count of [1, 2, 5, 21]) {
      it('F082 announces ' + count + ' findings in ' + locale + ' without inflection', () => {
        const projection = report({ findings: Array.from({ length: count }, (_, i) => finding({ findingId: String(i), techniqueId: 'DET-001' })) });
        const message = announcementFor(projection, msg('status_active'))!;
        const text = resolveMessage((key, subs = []) => table[key]!.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => {
          const index = Number(table[key]!.placeholders![name.toLowerCase()]!.content.slice(1)) - 1;
          return subs[index]!;
        }), message);
        expect(text).toBe(locale === 'ru'
          ? 'Отчёт обновлён. Находок: ' + count + '; состояние наблюдения — ' + table['status_active']!.message
          : 'Report updated. Findings: ' + count + '; observation state — ' + table['status_active']!.message);
      });
    }
  }

  it('ru (default) and en expose the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('manifest keys exist', () => {
    for (const key of ['extName', 'extDescription', 'actionTitle']) {
      expect(typeof ru[key]?.message).toBe('string');
      expect(typeof en[key]?.message).toBe('string');
    }
  });

  it('every message is a non-empty string', () => {
    for (const table of [ru, en]) {
      for (const [key, entry] of Object.entries(table)) {
        expect(typeof entry.message, key).toBe('string');
        expect((entry.message as string).trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('UI wording keeps the REQ-007 heading and never promises a verdict', () => {
    expect(ru['vendorsSectionTitle']?.message).toBe('Распознанные сервисы защиты и идентификации');
    for (const table of [ru, en]) {
      for (const entry of Object.values(table)) {
        const text = String(entry.message).toLowerCase();
        expect(text.includes('легитимн')).toBe(false);
        expect(text.includes('100 %') || text.includes('100%')).toBe(false);
      }
    }
  });
});
