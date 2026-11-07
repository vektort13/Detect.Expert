// ADR-020 §D (S09): receivers of a prompt with more than one destination — a checkbox per receiver (all checked by
// default), with the truthful state of its latest request (sent / stopped by a rule / outcome not observed). Receivers
// beyond the eight a prompt names are counted, not listed.

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import type { Message } from '../../../view-models/message';
import type { FirewallReceiverVM } from '../../../view-models/protect-firewall';

export interface FirewallReceiversProps {
  receivers: ReadonlyArray<FirewallReceiverVM>;
  hidden: Message | null;
  disabled: boolean;
  onChange: (receiver: string, checked: boolean) => void;
}

export function FirewallReceivers(props: FirewallReceiversProps): JSX.Element {
  return (
    <fieldset class="fw-receivers" data-fw-receivers={String(props.receivers.length)}>
      <legend class="fw-scope__legend">{t('fw_receivers_legend')}</legend>
      <ul class="fw-receivers__list">
        {props.receivers.map((r, i) => (
          <li key={r.receiver} class="fw-receivers__item" data-fw-receiver-state={r.state}>
            <input
              type="checkbox"
              id={'fw-receiver-' + String(i)}
              checked={r.checked}
              disabled={props.disabled}
              onChange={(event) => props.onChange(r.receiver, event.currentTarget.checked)}
            />
            <label for={'fw-receiver-' + String(i)}>
              <span class="fw-receivers__host">{r.receiver}</span>
              <span class="fw-receivers__state"> — {tm(r.stateLabel)}</span>
            </label>
          </li>
        ))}
      </ul>
      {props.hidden !== null ? <p class="fw-receivers__hidden">{tm(props.hidden)}</p> : null}
    </fieldset>
  );
}
