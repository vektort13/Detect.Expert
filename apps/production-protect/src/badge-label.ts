// ADR-047 (S1, port plan §2.3): per-tab badge of the module «Защита» while firewall prompts wait in the tab: text
// '1'…'9' / '9+' (vendored firewallBadgeText), the vendored module colour, and the vendored ru/en tooltip
// badge_tooltip_firewall. Production languages other than ru get the en text (the module ships ru and en only).
// Only the two tooltip entries are bundled (named JSON imports), not the vendored catalogs.

import { BADGE_FIREWALL_COLOR } from '../../../vendor/protect-722fae8/packages/background/src/badge';
import { firewallBadgeText } from '../../../vendor/protect-722fae8/packages/engine/src/badge';
import { badge_tooltip_firewall as EN_TOOLTIP } from '../../../vendor/protect-722fae8/apps/extension/_locales/en/messages.json';
import { badge_tooltip_firewall as RU_TOOLTIP } from '../../../vendor/protect-722fae8/apps/extension/_locales/ru/messages.json';
import { formatEntry } from './format-message';
import type { ProtectBadge } from './host-api';

export const PROTECT_BADGE_COLOR: string = BADGE_FIREWALL_COLOR;

/** Module catalog language for a production UI language id (ru_RU-like ids are not used by production). */
export function protectLanguage(language: unknown): 'ru' | 'en' {
  return language === 'ru' ? 'ru' : 'en';
}

/** Badge for `pending` prompts, or null for 0 / invalid (a count of 0 is never shown). */
export function protectBadgeLabel(pending: number, language: unknown): ProtectBadge | null {
  const text = firewallBadgeText(pending);
  if (text === '') return null;
  const entry = protectLanguage(language) === 'ru' ? RU_TOOLTIP : EN_TOOLTIP;
  return { text, color: PROTECT_BADGE_COLOR, title: formatEntry(entry, [String(Math.floor(pending))]) };
}
