// Approximate activity timeline (S13, E13-02, spec V §7): one text row per technique with page-hook buckets, plus a
// decorative aria-hidden bar placed with logical CSS properties. No animation; not rendered without rows.

import { t, tm } from '../i18n';
import type { TimelineRow } from '../view-models/timeline';

export interface ActivityTimelineProps {
  idPrefix: string;
  rows: ReadonlyArray<TimelineRow>;
  /** The sensors started after the page began running (late-start): the count does not start at page load. */
  lateStart: boolean;
}

export function ActivityTimeline(props: ActivityTimelineProps) {
  if (props.rows.length === 0) return null;
  const id = props.idPrefix + '-timeline';
  return (
    <section class="section timeline" aria-labelledby={id + '-title'} aria-describedby={id + '-desc'} data-activity-timeline="true">
      <h3 id={id + '-title'} class="group__title">
        {t('timeline_title')}
      </h3>
      <p id={id + '-desc'} class="small muted">
        {t('timeline_desc')}
      </p>
      {props.lateStart ? <p class="small muted" data-timeline-late-start="true">{t('timeline_late_start')}</p> : null}
      <ol class="timeline__list">
        {props.rows.map((row) => (
          <li key={row.techniqueId} class="timeline__row" data-timeline-row={row.techniqueId}>
            <span class="timeline__text small">{tm(row.label)}</span>
            <span class="timeline__track" aria-hidden="true">
              <span class="timeline__bar" style={{ '--timeline-start': row.startPct + '%', '--timeline-width': row.widthPct + '%' }} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
