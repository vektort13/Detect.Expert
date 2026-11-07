// Import only one static catalog entry per language into the worker, never the UI runtime.
import { badge_tooltip as ru } from '../../../apps/extension/_locales/ru/messages.json';
import { badge_tooltip as en } from '../../../apps/extension/_locales/en/messages.json';
import { badge_tooltip as zh } from '../../../apps/extension/_locales/zh_CN/messages.json';
import { badge_tooltip as vi } from '../../../apps/extension/_locales/vi/messages.json';
import { badge_tooltip as es } from '../../../apps/extension/_locales/es/messages.json';
import { badge_tooltip as ar } from '../../../apps/extension/_locales/ar/messages.json';
import { badge_tooltip as uk } from '../../../apps/extension/_locales/uk/messages.json';
import { badge_tooltip as fr } from '../../../apps/extension/_locales/fr/messages.json';
import { badge_tooltip as pt } from '../../../apps/extension/_locales/pt_BR/messages.json';
import { badge_tooltip as hi } from '../../../apps/extension/_locales/hi/messages.json';
import { badge_tooltip as ur } from '../../../apps/extension/_locales/ur/messages.json';
import { badge_tooltip as ja } from '../../../apps/extension/_locales/ja/messages.json';

export const BADGE_LANGUAGE_KEY = 'ui-language-v1';
const labels: Record<string, { message: string }> = { ru, en, zh_CN: zh, vi, es, ar, uk, fr, pt_BR: pt, hi, ur, ja };
export function badgeLanguage(value: unknown): string | null {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? value : null;
}
export function badgeBrowserLanguage(value: string): string {
  const base = value.toLowerCase().replaceAll('_', '-').split('-')[0];
  if (base === 'zh') return 'zh_CN';
  if (base === 'pt') return 'pt_BR';
  return badgeLanguage(base) ?? 'en';
}
export function badgeLabel(language: string | null, count: number): string | null {
  return language === null ? null : labels[language]?.message.replace(/\$N\$/g, String(count)) ?? null;
}
