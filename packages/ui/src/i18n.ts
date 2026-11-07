// i18n helper: chrome.i18n.getMessage with a visible fallback (the key itself) outside the extension.
// ru is default_locale; chrome.i18n follows the browser UI locale, not the manifest default.

import { resolveMessage } from './view-models/message';
import type { Message, Translate } from './view-models/message';

interface I18nApi {
  getMessage(messageName: string, substitutions?: string | string[]): string;
  getUILanguage(): string;
}

function i18nApi(): I18nApi | null {
  if (typeof chrome === 'undefined') return null;
  const candidate = (chrome as { i18n?: Partial<I18nApi> }).i18n;
  if (candidate === undefined || typeof candidate.getMessage !== 'function') return null;
  return candidate as I18nApi;
}

/** Fallback outside the extension (unit tests, static previews): the key plus its substitutions. */
export function fallbackMessage(key: string, subs?: ReadonlyArray<string>): string {
  return subs !== undefined && subs.length > 0 ? key + '[' + subs.join(', ') + ']' : key;
}

export const t: Translate = (key, subs) => {
  const api = i18nApi();
  if (api !== null) {
    try {
      const text = subs === undefined ? api.getMessage(key) : api.getMessage(key, [...subs]);
      if (typeof text === 'string' && text !== '') return text;
    } catch {
      // fall through to the visible fallback
    }
  }
  return fallbackMessage(key, subs);
};

export type UiLocale = 'ru' | 'en';

/** Locale actually served by chrome.i18n: `en*` UI languages get the en table, everything else the ru default. */
export function uiLocale(): UiLocale {
  const api = i18nApi();
  if (api === null) return 'ru';
  try {
    return /^en\b/i.test(api.getUILanguage()) ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

export function applyDocumentLanguage(doc: Document): void {
  doc.documentElement.lang = uiLocale();
}

/** Resolves a message descriptor (key + substitutions, possibly nested) through `t`. */
export function tm(message: Message): string {
  return resolveMessage(t, message);
}

/** Like `t` but returns null instead of the key when the locale has no such message (used for free-form codes). */
export function tOptional(key: string): string | null {
  const api = i18nApi();
  if (api === null) return null;
  try {
    const text = api.getMessage(key);
    return typeof text === 'string' && text !== '' ? text : null;
  } catch {
    return null;
  }
}
