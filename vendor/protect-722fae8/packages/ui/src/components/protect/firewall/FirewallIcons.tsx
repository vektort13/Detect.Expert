// ADR-020 §D (S09): inline icons of the firewall card (no external resources). Decorative: aria-hidden, currentColor,
// so forced-colors mode recolors them with the text.

import type { JSX } from 'preact';
import { resolveMessage } from '../../../view-models/message';
import type { Message, MessageJoin } from '../../../view-models/message';
import { t } from '../../../i18n';
import type { FirewallText } from '../../../view-models/protect-firewall';

export function ShieldIcon(): JSX.Element {
  return (
    <svg class="fw-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 2.5 4.5 5.5v5.6c0 4.6 3.1 8.6 7.5 10.4 4.4-1.8 7.5-5.8 7.5-10.4V5.5L12 2.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path d="M12 7.5v5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="16.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Resolves a view-model text: a message, a list of messages or a technical token. */
export function fwText(value: FirewallText): string {
  if (typeof value === 'string') return value;
  if ('join' in value) return joinText(value);
  return resolveMessage(t, value as Message);
}

function joinText(value: MessageJoin): string {
  return value.join.map((item) => (typeof item === 'string' ? item : resolveMessage(t, item))).join(value.separator ?? ', ');
}
