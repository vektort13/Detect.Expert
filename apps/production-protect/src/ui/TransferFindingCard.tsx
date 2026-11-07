// ADR-052: the factual transfer card remains visible without a pending firewall decision.
// Only the current value-free projection is rendered; this card has no mutation or prompt capability.
import type { JSX } from 'preact';
import { isScriptHost, isScriptPathTemplate, isSiteName } from '@detect-expert/contracts';
import type { ProtectProjection, ProtectTransferEvidence } from '@detect-expert/contracts';
import { ShieldIcon, fwText } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/firewall/FirewallIcons';
import { joinMessages, msg } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/message';
import type { Message } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/message';
import { FIELD_KIND_KEYS, SINCE_INPUT_KEYS, encodingMessage, evidenceListView, evidenceRow, hostCategoryMessage, whereMessage } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-evidence';
import { REQUEST_KIND_KEYS, SUBMIT_TIMING_KEYS, readFirewallView, receiverAlertState } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-firewall';
import type { FirewallRowVM, FirewallText } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-firewall';
import { isPositiveTransfer } from '../findings';
import { t, tm } from './i18n-shim';

export interface TransferFindingCardProps {
  evidence: ProtectTransferEvidence;
  report: ProtectProjection;
}

/** Rich facts only. Real pending prompts keep the existing FirewallCard and its backend-bound actions. */
export function TransferFindingCard({ evidence, report }: TransferFindingCardProps): JSX.Element | null {
  if (!isPositiveTransfer(evidence) || !isSiteName(report.site) || (evidence.endpointHost !== null && !isScriptHost(evidence.endpointHost))) return null;
  const firewall = readFirewallView(report.firewall);
  const receiver = evidence.receiver ?? hostCategoryMessage(evidence.receiverCategory ?? 'unknown');
  const view = firewall?.receivers.find(item => item.receiver === evidence.receiver);
  const delivery = receiverAlertState(view, firewall?.enforcement ?? 'off', evidence.deliveryState);
  const field = msg(FIELD_KIND_KEYS[evidence.fieldKind]);
  const alert = delivery === 'sent'
    ? msg(evidence.submitTiming === 'before-submit' ? 'fw_alert_sent_before_submit' : 'fw_alert_sent', receiver, field)
    : delivery === 'stopped' ? msg('fw_alert_stopped', receiver) : msg('fw_alert_unknown', receiver, field);
  const row = evidenceRow(evidence);
  const list = evidenceListView(report, null);
  const initiator = isSiteName(evidence.initiatorSite) ? evidence.initiatorSite : null;
  const sender = evidence.frameContext === 'top'
    ? msg('fw_sender_top', initiator ?? report.site)
    : initiator !== null ? msg('fw_sender_frame', initiator) : msg('fw_sender_frame_unknown');
  const script = evidence.attributionConfidence === 'sampled-stack' && evidence.script?.kind === 'external' &&
    (evidence.script.scheme === 'http' || evidence.script.scheme === 'https') && isScriptHost(evidence.script.host) && isScriptPathTemplate(evidence.script.pathTemplate)
    ? evidence.script.host : null;
  const company = view?.vendorId !== undefined && view.vendorConfidence !== 'none' ? view.vendorId : null;
  let data: FirewallText = field;
  if ((evidence.location === 'query' || evidence.location === 'body-form' || evidence.location === 'body-json') && evidence.paramName !== undefined) data = msg('fw_data_param', field, evidence.paramName);
  else if (evidence.location === 'path') data = msg('fw_data_path', field);
  else if (evidence.location === 'body-text') data = msg('fw_data_body', field);
  const moment: Message[] = [msg(SUBMIT_TIMING_KEYS[evidence.submitTiming])];
  if (evidence.sinceInput !== undefined) moment.push(msg(SINCE_INPUT_KEYS[evidence.sinceInput]));
  const rows: FirewallRowVM[] = [
    { id: 'sender', label: msg('fw_row_sender'), value: sender, extra: script === null ? null : msg('fw_sender_script_sampled', script) },
    { id: 'company', label: msg('fw_row_company'), value: company ?? msg('fw_company_not_checked'), extra: company === null ? null : msg('fw_company_no_trust') },
    { id: 'receiver', label: msg('fw_row_receiver'), value: receiver, extra: null },
    { id: 'data', label: msg(delivery === 'sent' ? 'fw_row_data' : 'fw_row_data_found'), value: data, extra: null },
    { id: 'moment', label: msg('fw_row_moment'), value: joinMessages(moment, ' · '), extra: null },
  ];
  const proof: Message[] = [msg('fw_ev_kind', msg(REQUEST_KIND_KEYS[evidence.requestKind]))];
  const where = whereMessage(evidence);
  if (where !== null) proof.push(where);
  proof.push(msg('fw_ev_encoding', joinMessages(evidence.encodings.map(encodingMessage))), msg('fw_ev_match', field));
  if (row.hashNote) proof.push(msg('protect_hash_note'));
  proof.push(row.confidence, msg('integrity_derived'), ...row.limitations);
  if (row.count !== null) proof.push(row.count);
  const titleId = 'findings-transfer-' + evidence.evidenceId;
  const requestHost = evidence.endpointHost ?? evidence.receiver ?? fwText(receiver);
  const title = evidence.transferClass.startsWith('third-party') ? 'fw_card_title' : 'protect_leak_section_title';
  return (
    <section class="fw-card" aria-labelledby={titleId} data-findings-transfer-card={evidence.evidenceId} data-fw-card={delivery} data-fw-readonly="true">
      <header class="fw-card__head">
        <span class="fw-card__icon"><ShieldIcon /></span>
        <div class="fw-card__heading">
          <h2 id={titleId} class="fw-card__title" tabIndex={-1}>{t(title)}</h2>
          <p class="fw-card__site"><span>{tm(msg('fw_card_site', report.site))}</span><span class="fw-card__brand">{t('fw_brand')}</span></p>
        </div>
      </header>
      <div class={'state fw-alert' + (delivery === 'sent' ? ' state--attention' : '')} data-fw-alert={delivery}><p class="state__line">{tm(alert)}</p></div>
      <ul class="fw-chips"><li class="fw-chip">{tm(field)}</li>{evidence.encodings.map(encoding => <li key={encoding} class="fw-chip">{tm(encodingMessage(encoding))}</li>)}</ul>
      {list?.coverage !== null && list?.coverage !== undefined ? <p class="leaks__coverage small muted">{tm(list.coverage)}</p> : null}
      {list !== null && list.docNotes.length > 0 ? <ul class="leaks__notes small muted" data-protect-doc-notes="true">{list.docNotes.map((note, index) => <li key={String(index)}>{tm(note)}</li>)}</ul> : null}
      <dl class="fw-rows">
        {rows.map(item => (
          <div key={item.id} class="fw-row" data-fw-row={item.id}>
            <dt class="fw-row__label">{tm(item.label)}</dt>
            <dd class="fw-row__value"><span class={item.id === 'receiver' ? 'fw-row__host' : undefined}>{fwText(item.value)}</span>{item.extra !== null ? <span class="fw-row__extra">{tm(item.extra)}</span> : null}</dd>
          </div>
        ))}
      </dl>
      <details class="fw-evidence">
        <summary class="fw-evidence__summary">{t('fw_evidence_summary')}</summary>
        <div class="fw-evidence__body">
          <p class="fw-evidence__request">{evidence.method + ' ' + requestHost + evidence.endpointPathTemplate}</p>
          {proof.map((line, index) => <p key={String(index)} class="fw-evidence__line">{tm(line)}</p>)}
          {script === null ? <p class="fw-evidence__line">{t('fw_sender_script_unknown')}</p> : null}
        </div>
      </details>
    </section>
  );
}
