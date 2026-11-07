// ADR-020 §D, §11 (S09): the firewall card of the popup (structure of the owner's prototype, extension palette).
// Shown when report.firewall.prompt holds a prompt (the window never opens by itself: the badge is the signal).
// Order: head (shield, title, «на сайте X», «Фаервол»); alert (.state--attention for sent, .state for stopped and
// unknown); note «отправленный запрос вернуть нельзя»; chips (field type · encoding); dl (who sent, company, to, what,
// when); «Показать доказательство»; receivers (more than one); scope; rule effect; two equal 40 px buttons (block next
// / keep blocking — accent, never red — and allow) or «Понятно» (warn-only, no permission); footer (lower-bound
// counter, «Не беспокоить 1 час», «Настройки фаервола» → options.html#firewall).
// After a decision FirewallResolved takes the place of the card and gets the focus. No value, hash, mask or URL is
// shown: the data has none. The decision buttons stay in the first screen of a 360 x 600 popup (sticky row).

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { t, tm, uiLocale } from '../../../i18n';
import { openProtectOptions } from '../../../messaging';
import { useFirewallCard } from '../../../app/useFirewall';
import { useThrottledAnnouncement } from '../../LiveRegion';
import {
  firewallCardView,
  firewallLiveText,
  firewallNotices,
  firewallResolvedView,
  firewallSnoozedUntil,
} from '../../../view-models/protect-firewall';
import type { FirewallCardVM, FirewallNoticeVM } from '../../../view-models/protect-firewall';
import type { ProtectPopupSlotProps } from '../ProtectPopupArea';
import { FirewallReceivers } from './FirewallReceivers';
import { FIREWALL_RESOLVED_TITLE_ID, FirewallResolved } from './FirewallResolved';
import { FirewallScopePicker } from './FirewallScopePicker';
import { ShieldIcon, fwText } from './FirewallIcons';

export const FIREWALL_CARD_TITLE_ID = 'fw-card-title';

function formatTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(11, 16);
  }
}

function focusById(id: string): void {
  const el = document.getElementById(id);
  if (el === null) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus();
}

function scopeSummary(vm: FirewallCardVM): string {
  const selected = vm.scopes.find((s) => s.scope === vm.scope);
  return selected === undefined ? '' : t('fw_scope_legend') + ': ' + tm(selected.label) + ' — ' + tm(selected.desc);
}

interface NoticeListProps {
  notices: ReadonlyArray<FirewallNoticeVM>;
  busy: boolean;
  onUndo: (undoId: string) => void;
}

function NoticeList(props: NoticeListProps): JSX.Element | null {
  if (props.notices.length === 0) return null;
  return (
    <ul class="fw-notices">
      {props.notices.map((n, i) => (
        <li key={String(i)} class="fw-notice" data-fw-notice={n.kind}>
          <span>{tm(n.message)}</span>
          {n.undoId !== null ? (
            <button type="button" class="button button--text" aria-busy={props.busy} onClick={() => props.onUndo(n.undoId!)}>
              {t('fw_action_undo')}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface CardBodyProps {
  vm: FirewallCardVM;
  busy: boolean;
  onScope: (scope: FirewallCardVM['scope']) => void;
  onReceiver: (receiver: string, checked: boolean) => void;
  onBlock: () => void;
  onAllow: () => void;
  onAck: () => void;
  onUndo: (undoId: string) => void;
  onSnooze: () => void;
  message: JSX.Element | null;
}

function CardBody(props: CardBodyProps): JSX.Element {
  const { vm } = props;
  const sent = vm.alert.state === 'sent';
  return (
    <section class="fw-card" aria-labelledby={FIREWALL_CARD_TITLE_ID} data-fw-card={vm.alert.state} data-fw-mode={vm.mode}>
      <header class="fw-card__head">
        <span class="fw-card__icon">
          <ShieldIcon />
        </span>
        <div class="fw-card__heading">
          <h2 id={FIREWALL_CARD_TITLE_ID} class="fw-card__title" tabIndex={-1}>
            {tm(vm.title)}
          </h2>
          <p class="fw-card__site">
            <span>{tm(vm.siteLine)}</span>
            <span class="fw-card__brand">{t('fw_brand')}</span>
          </p>
        </div>
      </header>

      <div class={'state fw-alert' + (sent ? ' state--attention' : '')} data-fw-alert={vm.alert.state}>
        <p class="state__line">{tm(vm.alert.message)}</p>
      </div>
      {vm.note !== null ? <p class="fw-note">{tm(vm.note)}</p> : null}

      {vm.chips.length > 0 ? (
        <ul class="fw-chips">
          {vm.chips.map((chip, i) => (
            <li key={String(i)} class="fw-chip">
              {tm(chip)}
            </li>
          ))}
        </ul>
      ) : null}

      <dl class="fw-rows">
        {vm.rows.map((row) => (
          <div key={row.id} class="fw-row" data-fw-row={row.id}>
            <dt class="fw-row__label">{tm(row.label)}</dt>
            <dd class="fw-row__value">
              <span class={row.id === 'receiver' ? 'fw-row__host' : undefined}>{fwText(row.value)}</span>
              {row.extra !== null ? <span class="fw-row__extra">{tm(row.extra)}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      <details class="fw-evidence">
        <summary class="fw-evidence__summary">{t('fw_evidence_summary')}</summary>
        <div class="fw-evidence__body">
          {vm.evidence !== null ? (
            <>
              <p class="fw-evidence__request">{vm.evidence.request}</p>
              {vm.evidence.lines.map((line, i) => (
                <p key={String(i)} class="fw-evidence__line">
                  {tm(line)}
                </p>
              ))}
            </>
          ) : (
            <p class="fw-evidence__line">{t('fw_ev_none')}</p>
          )}
          {vm.scriptNote !== null ? <p class="fw-evidence__line">{tm(vm.scriptNote)}</p> : null}
        </div>
      </details>

      {vm.receivers.length > 1 ? (
        <FirewallReceivers receivers={vm.receivers} hidden={vm.hidden} disabled={props.busy} onChange={props.onReceiver} />
      ) : vm.hidden !== null ? (
        <p class="fw-receivers__hidden">{tm(vm.hidden)}</p>
      ) : null}

      {vm.mode === 'decide' ? (
        <>
          <FirewallScopePicker scopes={vm.scopes} scope={vm.scope} note={tm(vm.scopeNote)} disabled={props.busy} onChange={props.onScope} />
          <p id="fw-rule-effect" class="fw-effect">
            {tm(vm.ruleEffect)}
          </p>
        </>
      ) : null}

      {vm.blockingNotice !== null ? (
        <p class="state state--attention fw-blocking" data-fw-blocking="true">
          {tm(vm.blockingNotice.message)}
        </p>
      ) : null}

      {vm.modeNote !== null ? (
        <p class="fw-note" data-fw-mode-note="true">
          {tm(vm.modeNote)}
        </p>
      ) : null}

      <div class="fw-decision" data-fw-decision={vm.mode}>
        {vm.mode === 'decide' ? (
          <>
            {/* The chosen scope, repeated for sighted users while the row is pinned over a scrolled card (the fieldset
                above is the accessible control). */}
            <p class="fw-decision__scope" aria-hidden="true" data-fw-decision-scope="true">
              {scopeSummary(vm)}
            </p>
            <button
              type="button"
              class="button button--primary fw-action"
              data-fw-action="block"
              aria-describedby="fw-rule-effect"
              aria-disabled={!vm.canDecide}
              aria-busy={props.busy}
              onClick={() => props.onBlock()}
            >
              {tm(vm.blockLabel)}
            </button>
            <button
              type="button"
              class="button fw-action"
              data-fw-action="allow"
              aria-describedby="fw-allow-desc"
              aria-disabled={!vm.canDecide}
              aria-busy={props.busy}
              onClick={() => props.onAllow()}
            >
              {t('fw_action_allow')}
            </button>
          </>
        ) : (
          <button type="button" class="button button--primary fw-action" data-fw-action="ack" aria-busy={props.busy} onClick={() => props.onAck()}>
            {t('fw_action_ack')}
          </button>
        )}
      </div>
      {vm.mode === 'decide' ? (
        <p id="fw-allow-desc" class="fw-allow-desc">
          {tm(vm.allowDesc)}
        </p>
      ) : null}
      {props.message}

      <NoticeList notices={vm.notices} busy={props.busy} onUndo={props.onUndo} />

      <footer class="fw-foot">
        {vm.counter !== null ? (
          <p class="fw-foot__counter" data-fw-counter="true">
            {tm(vm.counter)}
            {vm.counterNote !== null ? <span class="fw-foot__note"> {tm(vm.counterNote)}</span> : null}
          </p>
        ) : null}
        <p class="fw-foot__actions">
          <button type="button" class="button button--text" aria-busy={props.busy} onClick={() => props.onSnooze()}>
            {t('protect_snooze')}
          </button>
          <button type="button" class="button button--text" onClick={() => void openProtectOptions('firewall')}>
            {t('fw_action_settings')}
          </button>
        </p>
      </footer>
    </section>
  );
}

export function FirewallCard(props: ProtectPopupSlotProps): JSX.Element | null {
  const session = useFirewallCard({ tabId: props.tabId, report: props.report, refreshReport: props.refreshReport, refreshState: props.refreshState });
  const card = useMemo(() => firewallCardView(props.state, props.report, session.draft), [props.state, props.report, session.draft]);
  const notices = useMemo(() => (card === null && props.state.features.includes('firewall') ? firewallNotices(props.report) : []), [card, props.state, props.report]);
  const snoozedUntil = firewallSnoozedUntil(props.state, Date.now());
  const liveMessage = firewallLiveText(card);
  const live = useThrottledAnnouncement(liveMessage === null ? null : tm(liveMessage));
  const resolved = session.resolution === null ? null : firewallResolvedView(session.resolution);
  const focusCard = useRef(false);
  const hadResolution = useRef(false);

  // After «Отменить решение» the card returns: its heading gets the focus.
  useEffect(() => {
    if (card !== null && focusCard.current) {
      focusCard.current = false;
      focusById(FIREWALL_CARD_TITLE_ID);
    }
  }, [card]);

  // Closing the outcome: focus the card when one is left, otherwise the module status line (never lost to body).
  useEffect(() => {
    if (resolved !== null) {
      hadResolution.current = true;
      return;
    }
    if (!hadResolution.current) return;
    hadResolution.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      focusById(document.getElementById(FIREWALL_CARD_TITLE_ID) !== null ? FIREWALL_CARD_TITLE_ID : 'popup-protect-status');
    }
  }, [resolved]);

  if (!props.state.features.includes('firewall')) return null;

  const message = session.message === null ? null : (
    <p class={'state fw-message' + (session.message.tone === 'error' ? ' state--error' : session.message.tone === 'attention' ? ' state--attention' : '')} data-fw-message="true">
      {tm(session.message.message)}
    </p>
  );
  const undo = (undoId?: string): void => {
    focusCard.current = true;
    void session.undo(undoId).then((ok) => {
      if (!ok) focusCard.current = false;
    });
  };

  return (
    <div class="fw" data-fw-root="true">
      <div class="sr-only" aria-live="polite" aria-atomic="true" data-fw-live="true">
        {live}
      </div>
      {resolved !== null ? (
        <FirewallResolved vm={resolved} busy={session.busy} onUndo={() => undo()} onClose={() => session.closeResolution()} />
      ) : null}
      {card !== null ? (
        <CardBody
          vm={card}
          busy={session.busy}
          onScope={session.setScope}
          onReceiver={session.setReceiver}
          onBlock={() => {
            if (card.canDecide) void session.decide(card, 'block');
          }}
          onAllow={() => {
            if (card.canDecide) void session.decide(card, 'allow');
          }}
          onAck={() => void session.dismiss(card)}
          onUndo={(id) => undo(id)}
          onSnooze={() => {
            void session.snooze(60).then((ok) => {
              if (ok) focusById('fw-snoozed');
            });
          }}
          message={message}
        />
      ) : (
        <>
          {resolved === null ? message : null}
          <NoticeList notices={notices} busy={session.busy} onUndo={(id) => undo(id)} />
        </>
      )}
      {card === null && snoozedUntil !== null ? (
        <div id="fw-snoozed" class="fw-snoozed" data-fw-snoozed="true">
          <p class="fw-snoozed__line">{t('protect_snooze_until', [formatTime(snoozedUntil)])}</p>
          <p class="fw-foot__actions">
            <button type="button" class="button button--text" aria-busy={session.busy} onClick={() => void session.snooze(0)}>
              {t('protect_snooze_cancel')}
            </button>
            <button type="button" class="button button--text" onClick={() => void openProtectOptions('firewall')}>
              {t('fw_action_settings')}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export { FIREWALL_RESOLVED_TITLE_ID };
