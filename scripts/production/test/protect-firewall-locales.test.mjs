// The new Firewall launcher is localized; the complete settings keep their ru/en catalogue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { PRODUCTION_LANGUAGES } from '../../production-languages.mjs';

const root = resolve(import.meta.dirname, '../../..');
const read = name => JSON.parse(readFileSync(join(root, 'apps/production-protect/src/locales', name), 'utf8'));
const launcher = read('firewall-launcher.json'), branding = read('firewall-branding.json'), catalog = read('catalog.generated.json');
const compiled = await build({ entryPoints: [join(root, 'apps/production-protect/src/ui/i18n-shim.ts')], bundle: true, write: false, platform: 'neutral', format: 'esm', logLevel: 'silent' });
const shim = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const toggleKeys = ['firewall_launcher_enable', 'firewall_launcher_disable', 'firewall_launcher_updating', 'firewall_launcher_toggle_error'];
const launcherKeys = ['firewall_launcher_title', 'firewall_launcher_open', 'firewall_launcher_on', 'firewall_launcher_off', 'firewall_launcher_loading', 'firewall_launcher_status', 'firewall_launcher_settings', 'firewall_launcher_unavailable', 'firewall_launcher_open_error', 'fw_overlay_review_required', ...toggleKeys];
const stateKeys = ['protect_state_off', 'protect_state_active', 'protect_state_needs_consent', 'protect_state_needs_permission', 'protect_state_organization_disabled', 'protect_state_degraded'];

test('all 21 production languages have exactly the new launcher and six real state labels', () => {
  assert.deepEqual(Object.keys(launcher), PRODUCTION_LANGUAGES.map(language => language.id));
  assert.equal(Object.keys(launcher).length, 21);
  const expected = [...launcherKeys, ...stateKeys].sort();
  for (const [language, messages] of Object.entries(launcher)) {
    assert.deepEqual(Object.keys(messages).sort(), expected, language);
    assert.equal(messages.firewall_launcher_title.message, 'Firewall', language);
    for (const [key, entry] of Object.entries(messages)) {
      assert.ok(entry.message.trim().length > 0, language + ':' + key);
      assert.notEqual(entry.message, key, language + ':' + key);
      assert.equal(/[?\uFFFD]/u.test(entry.message), false, language + ':' + key + ': Unicode text must survive serialization');
      assert.deepEqual([...entry.message.matchAll(/\$[1-9]/g)].map(match => match[0]), key === 'firewall_launcher_status' ? ['$1'] : [], language + ':' + key);
      assert.equal(/\$[a-z_]+\$/i.test(entry.message), false, language + ':' + key);
    }
    assert.equal(new Set(['firewall_launcher_on', 'firewall_launcher_off', 'firewall_launcher_loading', 'firewall_launcher_unavailable'].map(key => messages[key].message)).size, 4, language + ': loading/error/off are distinct');
    assert.equal(new Set(stateKeys.map(key => messages[key].message)).size, 6, language + ': real states remain distinct');
    assert.equal(new Set(toggleKeys.map(key => messages[key].message)).size, 4, language + ': enable, disable, pending and failure remain distinct');
  }
});

test('non-Latin launcher translations retain their native scripts and Unicode loading punctuation', () => {
  const scripts = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u,
    zh_CN: /\p{Script=Han}/u, yue: /\p{Script=Han}/u, wuu: /\p{Script=Han}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u,
    te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u, ko: /\p{Script=Hangul}/u, ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u };
  for (const [language, script] of Object.entries(scripts)) {
    for (const key of ['firewall_launcher_open_error', ...toggleKeys]) assert.match(launcher[language][key].message, script, language + ':' + key);
  }
  for (const [language, messages] of Object.entries(launcher)) assert.ok(messages.firewall_launcher_loading.message.endsWith('…'), language);
  for (const [language, messages] of Object.entries(launcher)) assert.ok(messages.firewall_launcher_updating.message.endsWith('…'), language);
  for (const messages of Object.values(branding.messages)) for (const entry of Object.values(messages)) assert.equal(/\?{2,}|\uFFFD/u.test(entry.message), false);
});

test('actual selected language resolves launcher, status descriptions and navigation without English fallback', () => {
  for (const { id } of PRODUCTION_LANGUAGES) {
    shim.setProductionLocale(id);
    assert.equal(shim.launcherLocaleOf(id), id);
    for (const key of [...launcherKeys, ...stateKeys]) {
      const subs = key === 'firewall_launcher_status' ? [launcher[id].protect_state_organization_disabled.message] : [];
      assert.equal(shim.t(key, subs), launcher[id][key].message.replace('$1', subs[0] ?? ''), id + ':' + key);
    }
    assert.equal(shim.t('protect_settings_link'), launcher[id].firewall_launcher_settings.message, id);
    assert.equal(shim.t('protect_status_line', ['state-marker']), launcher[id].firewall_launcher_status.message.replace('$1', 'state-marker'), id);
    assert.equal(shim.tOptional('firewall_launcher_title'), 'Firewall', id);
  }
});

test('launcher language and RTL are separate from the full-module fallback language', () => {
  for (const { id } of PRODUCTION_LANGUAGES) {
    shim.setProductionLocale(id);
    assert.equal(shim.launcherDirectionOf(id), id === 'ar' || id === 'ur' ? 'rtl' : 'ltr', id);
    assert.equal(shim.uiLocale(), id === 'ru' ? 'ru' : 'en', id);
    assert.equal(shim.isFallbackLocale(id), id !== 'ru' && id !== 'en', id);
    assert.equal(shim.t('fw_blocking_restart'), catalog[id === 'ru' ? 'ru' : 'en'].fw_blocking_restart.message, id);
  }
  for (const [input, expected] of [['ar-AE', 'ar'], ['ur-PK', 'ur'], ['zh-Hans', 'zh_CN'], ['pt-BR', 'pt_BR'], ['ru-RU', 'ru'], ['en-US', 'en'], ['unknown', 'en'], [null, 'en']]) assert.equal(shim.launcherLocaleOf(input), expected);
});

test('branding uses explicit keys only, preserving consent and unrelated protection-service wording', () => {
  assert.deepEqual(Object.keys(branding.aliases).sort(), ['protect_title', 'tab_protect', 'options_tab_protect', 'protect_page_title', 'protect_launcher_title', 'protect_launcher_open', 'protect_settings_link', 'fw_action_settings', 'protect_status_line', 'fw_brand'].sort());
  assert.deepEqual(Object.keys(branding.messages.ru).sort(), Object.keys(branding.messages.en).sort());
  for (const [key, alias] of Object.entries(branding.aliases)) { assert.ok(Object.hasOwn(launcher.en, alias), key); assert.equal(key.startsWith('protect_consent_'), false); }
  for (const language of ['ru', 'en']) {
    shim.setProductionLocale(language);
    for (const [key, entry] of Object.entries(branding.messages[language])) { assert.equal(shim.t(key), entry.message, key); assert.equal(key.startsWith('protect_consent_'), false); }
    for (const [key, entry] of Object.entries(catalog[language])) if (key.startsWith('protect_consent_')) assert.equal(shim.t(key), entry.message, language + ':' + key);
    assert.equal(shim.t('fw_mode_strict_warning'), catalog[language].fw_mode_strict_warning.message, 'generic protection-services text is unchanged');
  }
});

test('new localized overlay does not expand or claim translation of the complete settings catalogue', () => {
  assert.deepEqual(shim.catalogSize(), { ru: Object.keys(catalog.ru).length, en: Object.keys(catalog.en).length });
  for (const language of ['ru', 'en']) assert.ok(Object.keys(catalog[language]).length > 600);
  assert.equal(Object.keys(launcher.en).length, 20);
  assert.equal(shim.tOptional('firewall_nonexistent_translation'), null);
});
