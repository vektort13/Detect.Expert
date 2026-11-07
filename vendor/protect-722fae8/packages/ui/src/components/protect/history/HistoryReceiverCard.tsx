// ADR-020 §G (S12): receiver card of the history «Кто вас узнаёт» — mechanisms with their integrity badge and confidence,
// sites (≤ 200) with days and the last day, API families of the receiver's own frames (frame-only), and deletion of the
// row or of one site after a confirmation. Focus goes back to the card heading after a site deletion; after a row
// deletion the panel moves it (the card disappears).

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HistoryReceiverCard as Card, HistoryWindowDays } from '@detect-expert/contracts';
import { t, tm, uiLocale } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { msg } from '../../../view-models/message';
import { confidenceKey, familyNameKey, formatHistoryDay, mechanismMessage, parseHistoryCard, rowDomain } from '../../../view-models/protect-history';
import { ConfirmDialog } from '../../ConfirmDialog';
import { IntegrityBadge } from '../../IntegrityBadge';
import { PrepareRequestButton } from '../requests/PrepareRequestButton';

export interface HistoryReceiverCardProps {
  id: string;
  rowKey: string;
  windowDays: HistoryWindowDays;
  /** A deletion succeeded ('row': the row is gone; 'site': the list changed). */
  onDeleted: (target: 'row' | 'site') => void;
}

type Pending = { target: 'row'; key: string; label: string } | { target: 'site'; key: string; label: string };

export function HistoryReceiverCard(props: HistoryReceiverCardProps): JSX.Element {
  const [card, setCard] = useState<Card | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const invokerRef = useRef<HTMLButtonElement | null>(null);
  const locale = uiLocale();

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void protectUi.historyReceiver({ rowKey: props.rowKey, windowDays: props.windowDays }).then((result) => {
      if (!live) return;
      setLoaded(true);
      if (!result.ok) {
        setError(errorMessageKey(result.code));
        setCard(null);
        return;
      }
      setError(null);
      setCard(parseHistoryCard(result.response));
    });
    return () => {
      live = false;
    };
  }, [props.rowKey, props.windowDays, reload]);

  const confirm = async (p: Pending): Promise<void> => {
    setPending(null);
    setBusy(true);
    const result = await protectUi.historyDelete({ target: p.target, key: p.key });
    setBusy(false);
    if (!result.ok) {
      setError(errorMessageKey(result.code));
      invokerRef.current?.focus();
      return;
    }
    props.onDeleted(p.target);
    if (p.target === 'site') {
      setReload((n) => n + 1);
      headingRef.current?.focus();
    }
  };

  const titleId = props.id + '-title';
  const domain = card === null ? rowDomain({ rowKey: props.rowKey, domains: [] }) : rowDomain(card);
  return (
    <section id={props.id} class="history-card" aria-labelledby={titleId} aria-busy={!loaded || busy} data-history-card={props.rowKey}>
      <h4 id={titleId} ref={headingRef} class="history-card__title" tabIndex={-1}>
        <span class="mono" dir="ltr">{domain}</span>
      </h4>
      {!loaded ? <p class="small muted">{t('history_loading')}</p> : null}
      {error !== null ? <p class="state state--attention small" role="status">{t(error)}</p> : null}
      {card !== null ? (
        <>
          <h5 class="history-card__subtitle">{t('history_card_mechanisms')}</h5>
          {card.mechanisms.length === 0 ? (
            <p class="small muted">{t('history_card_no_mechanisms')}</p>
          ) : (
            <ul class="history-mechanisms">
              {card.mechanisms.map((m) => (
                <li key={m.mechanism} class="history-mechanism" data-history-mechanism={m.mechanism}>
                  <span>{tm(mechanismMessage(m))}</span>
                  <span class="history-mechanism__meta">
                    <span class="pill pill--muted">{t(confidenceKey(m))}</span>
                    <IntegrityBadge integrity={m.integrity} evidenceSource={m.evidenceSource} />
                    {m.attributionConfidence === 'frame-only' ? <span class="small muted">{t('attribution_frame_only')}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {card.families.length > 0 ? (
            <>
              <h5 class="history-card__subtitle">{t('history_card_families')}</h5>
              <ul class="history-card__list small">
                {card.families.map((f) => (
                  <li key={f.family} data-history-family={f.family}>{tm(msg('history_card_family', msg(familyNameKey(f.family)), f.sites, f.days))}</li>
                ))}
              </ul>
            </>
          ) : null}
          <h5 class="history-card__subtitle">{t('history_card_sites')}</h5>
          <ul class="history-card__sites">
            {card.sites.map((s) => (
              <li key={s.site} class="history-site" data-history-site={s.site}>
                <span class="mono" dir="ltr">{s.site}</span>
                <span class="small muted">{tm(msg('history_card_site_days', s.days, formatHistoryDay(s.last, locale)))}</span>
                <button
                  type="button"
                  class="button button--text small"
                  aria-label={t('history_delete_site') + ': ' + s.site}
                  disabled={busy}
                  onClick={(event) => {
                    invokerRef.current = event.currentTarget;
                    setPending({ target: 'site', key: s.site, label: s.site });
                  }}
                >
                  {t('history_delete_site')}
                </button>
              </li>
            ))}
          </ul>
          {card.moreSites > 0 ? <p class="small muted">{tm(msg('history_card_more_sites', card.moreSites))}</p> : null}
          <p class="actions">
            <PrepareRequestButton sourceKind="history" recordId={card.rowKey} />
            <button
              type="button"
              class="button"
              disabled={busy}
              data-history-delete-row="true"
              onClick={(event) => {
                invokerRef.current = event.currentTarget;
                setPending({ target: 'row', key: card.rowKey, label: domain });
              }}
            >
              {t('history_delete_row')}
            </button>
          </p>
        </>
      ) : loaded && error === null ? (
        <p class="small muted">{t('history_empty')}</p>
      ) : null}
      {pending !== null ? (
        <ConfirmDialog
          id={props.id + '-confirm'}
          title={pending.target === 'row' ? tm(msg('history_delete_row_confirm', pending.label)) : tm(msg('history_delete_site_confirm', pending.label))}
          description={t('history_delete_desc')}
          confirmLabel={pending.target === 'row' ? t('history_delete_row') : t('history_delete_site')}
          onConfirm={() => void confirm(pending)}
          onCancel={() => {
            setPending(null);
            invokerRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
