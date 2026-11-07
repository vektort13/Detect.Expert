// ADR-020 §B, §D (S07): popup list «Передача введённых данных» — at most five records, collapsed, most severe first,
// with the module's coverage on this page and its document-level limitations next to the list (review COV-01: e.g. a
// payment field that suspended reading, a SW restart, an overflowed budget). Each record: what happened (class +
// recipient), field type and encoding chips; expanding shows where, to which endpoint, when, the delivery (ADR-020
// §11) and the confidence.
// No value, hash, mask, value length, URL or query exists in the data, so none is shown. Palette: ui.css tokens.

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import { POPUP_EVIDENCE_LIMIT, evidenceListView } from '../../../view-models/protect-evidence';
import type { EvidenceRowVM } from '../../../view-models/protect-evidence';
import type { ProtectPopupSlotProps } from '../ProtectPopupArea';

export interface EvidenceItemProps {
  row: EvidenceRowVM;
  /** Side panel: rendered expanded. */
  open?: boolean;
}

/** One transfer record (popup and side panel). The severity is a color only, never a word like «опасно». */
export function EvidenceItem(props: EvidenceItemProps): JSX.Element {
  const { row } = props;
  return (
    <details class={'leak leak--' + row.severity} open={props.open === true} data-evidence-id={row.id} data-delivery={row.deliveryState}>
      <summary class="leak__summary">
        <span class="leak__title">{tm(row.title)}</span>
        <span class="leak__chips">
          <span class="leak__chip">{tm(row.field)}</span>
          {row.encodings.map((enc, i) => (
            <span class="leak__chip" key={String(i)}>
              {tm(enc)}
            </span>
          ))}
        </span>
      </summary>
      <div class="leak__body">
        {row.where !== null ? <p class="leak__line">{tm(row.where)}</p> : null}
        <p class="leak__line">{tm(row.endpoint)}</p>
        {row.since !== null ? <p class="leak__line small muted">{tm(row.since)}</p> : null}
        <p class="leak__line leak__delivery">{tm(row.delivery)}</p>
        <p class="leak__line small">{tm(row.confidence)}</p>
        {row.count !== null ? <p class="leak__line small muted">{tm(row.count)}</p> : null}
        {row.hashNote ? <p class="leak__line small muted">{t('protect_hash_note')}</p> : null}
        {row.limitations.length > 0 ? (
          <ul class="leak__limits small muted">
            {row.limitations.map((m, i) => (
              <li key={String(i)}>{tm(m)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

export function EvidenceList(props: ProtectPopupSlotProps): JSX.Element | null {
  if (!props.state.features.includes('value-match')) return null;
  const vm = evidenceListView(props.report, POPUP_EVIDENCE_LIMIT);
  if (vm === null) return null;
  return (
    <section class="leaks" aria-labelledby="popup-leaks-title" data-protect-leaks="popup">
      <h3 id="popup-leaks-title" class="leaks__title">
        {t('protect_leak_section_title')}
      </h3>
      {vm.coverage !== null ? <p class="leaks__coverage small muted">{tm(vm.coverage)}</p> : null}
      {vm.docNotes.length > 0 ? (
        <ul class="leaks__notes small muted" data-protect-doc-notes="">
          {vm.docNotes.map((m, i) => (
            <li key={String(i)}>{tm(m)}</li>
          ))}
        </ul>
      ) : null}
      {vm.empty !== null ? (
        <p class="leaks__empty small">{tm(vm.empty)}</p>
      ) : (
        <ul class="leaks__list">
          {vm.rows.map((row) => (
            <li key={row.id}>
              <EvidenceItem row={row} />
            </li>
          ))}
        </ul>
      )}
      {vm.hidden > 0 ? (
        <p class="leaks__more small">
          <button type="button" class="button button--text" onClick={() => props.openSidePanel()}>
            {t('protect_leak_more', [String(vm.hidden)])}
          </button>
        </p>
      ) : null}
    </section>
  );
}
