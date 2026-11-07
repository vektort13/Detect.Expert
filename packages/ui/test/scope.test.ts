import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCOPE_MODES } from '@detect-expert/contracts';
import { SCOPE_MODE_LABEL_KEYS, SCOPE_OPTIONS, parseHostInput, permissionOriginsFor, scopeRequest } from '../src/view-models/scope';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'extension', '_locales');

function messages(locale: string): Record<string, { message: string }> {
  return JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>;
}

describe('scope picker (spec A3 / ADR-003)', () => {
  it('offers off plus the three levels, each with a label and a promise text', () => {
    expect(SCOPE_OPTIONS.map((o) => o.mode)).toEqual(['off', 'active-tab', 'site', 'all-sites']);
    for (const mode of SCOPE_MODES) {
      expect(SCOPE_OPTIONS.some((o) => o.mode === mode)).toBe(true);
      expect(SCOPE_MODE_LABEL_KEYS[mode]).toMatch(/^scope/);
    }
  });

  it('promise texts are the honest A3 wording in ru and en', () => {
    const ru = messages('ru');
    const en = messages('en');
    const byMode = Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.mode, o]));
    expect(ru[byMode['active-tab']!.labelKey]?.message).toBe('Проверять с этого момента');
    expect(ru[byMode['active-tab']!.descKey]?.message).toBe('Наблюдения после включения; ранние вызовы могли быть пропущены.');
    expect(ru[byMode['site']!.labelKey]?.message).toBe('Всегда на этом сайте');
    expect(ru[byMode['site']!.descKey]?.message).toBe(
      'Перезагрузите страницу для анализа с начала. Ранние вызовы в разрешённых документах при следующей загрузке; сторонняя сеть может быть видна частично.',
    );
    expect(ru[byMode['all-sites']!.labelKey]?.message).toBe('На всех сайтах');
    expect(ru[byMode['all-sites']!.descKey]?.message).toBe(
      'Наиболее широкий доступ, без обещания полного покрытия workers, DNS и серверной логики.',
    );
    for (const option of SCOPE_OPTIONS) {
      for (const table of [ru, en]) {
        const desc = table[option.descKey]?.message ?? '';
        expect(desc.length).toBeGreaterThan(0);
        expect(desc.toLowerCase()).not.toMatch(/100 ?%|полное покрытие\.|full coverage\./);
      }
    }
  });

  it('requests optional host origins only for site / all-sites', () => {
    expect(permissionOriginsFor('off', 'example.com')).toBeNull();
    expect(permissionOriginsFor('active-tab', 'example.com')).toBeNull();
    expect(permissionOriginsFor('site', 'example.com')).toEqual(['https://example.com/*', 'http://example.com/*']);
    expect(permissionOriginsFor('site', null)).toBeNull();
    expect(permissionOriginsFor('all-sites', null)).toEqual(['http://*/*', 'https://*/*']);
  });

  it('builds ui-set-scope requests and refuses site without a host', () => {
    expect(scopeRequest('site', null)).toBeNull();
    expect(scopeRequest('site', 'example.com')).toEqual({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com' });
    expect(scopeRequest('all-sites', 'ignored.example')).toEqual({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    expect(scopeRequest('off', null)).toEqual({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
  });

  it('parses typed hosts through sanitizeHost', () => {
    expect(parseHostInput(' Example.COM ')).toBe('example.com');
    expect(parseHostInput('https://user:pw@shop.example:8443/path?q=1')).toBe('shop.example');
    expect(parseHostInput('*.example.com')).toBeNull();
    expect(parseHostInput('')).toBeNull();
    expect(parseHostInput('chrome://extensions')).toBeNull();
  });
});
