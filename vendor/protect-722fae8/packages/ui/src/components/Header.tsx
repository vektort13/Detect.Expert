// Header: page title, host (wraps, RTL-safe) and the status pill. The pill text carries the meaning; the
// tone only tints it (no colour-only meaning).

import { t, tm } from '../i18n';
import type { Tone } from '../view-models/coverage';
import type { Message } from '../view-models/message';

export interface HeaderProps {
  title: string;
  host: string | null;
  unknownHostKey?: string;
  status: Message;
  tone: Tone;
  observedSince: number | null;
}

function formatTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString();
  }
}

export function Header(props: HeaderProps) {
  return (
    <header class="header">
      <h1 class="app__title">{props.title}</h1>
      <div class="header__row">
        <span class="host" dir="auto">
          {props.host ?? t(props.unknownHostKey ?? 'host_unknown')}
        </span>
        <span class={'pill pill--' + props.tone}>{tm(props.status)}</span>
      </div>
      {props.observedSince !== null ? <p class="muted small header__since">{t('observed_since', [formatTime(props.observedSince)])}</p> : null}
    </header>
  );
}
