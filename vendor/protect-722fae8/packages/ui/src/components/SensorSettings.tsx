// Options page: sensor families (ADR-019, S11). One checkbox per family of the registry; a family disabled by the
// organization is shown checked-off and locked. Changes apply to pages loaded afterwards; open pages stop storing the
// family's data at once and lose its hooks only after a reload (the section text says so).

import type { ScopeState, SensorId } from '@detect-expert/contracts';
import { t, tm } from '../i18n';
import { sensorNotices, sensorRows } from '../view-models/sensors';

export interface SensorSettingsProps {
  id: string;
  scope: ScopeState | null;
  busy: boolean;
  onChange: (sensorId: SensorId, enabled: boolean) => void;
}

export function SensorSettings(props: SensorSettingsProps) {
  const rows = sensorRows(props.scope);
  const notices = sensorNotices(props.scope);
  const titleId = props.id + '-title';
  const descId = props.id + '-desc';
  return (
    <section class="section" aria-labelledby={titleId} data-sensor-settings="">
      <h2 id={titleId} class="section__title">{t('options_sensors_title')}</h2>
      <p id={descId} class="small muted">{t('options_sensors_desc')}</p>
      {notices.map((notice) => (
        <p key={notice.key} class="small state state--muted" data-sensor-notice={notice.key}>{tm(notice)}</p>
      ))}
      {rows.length > 0 ? (
        <fieldset class="scope__fieldset" aria-labelledby={titleId} aria-describedby={descId} aria-busy={props.busy}>
          {rows.map((row) => {
            const inputId = props.id + '-' + row.sensorId;
            const sensorDescId = inputId + '-desc';
            const stateId = inputId + '-state';
            return (
              <div key={row.sensorId} class="scope__option" data-sensor={row.sensorId}>
                <input
                  type="checkbox"
                  id={inputId}
                  checked={row.enabled}
                  disabled={row.locked}
                  aria-describedby={sensorDescId + ' ' + stateId}
                  onChange={(event) => {
                    if (row.locked || props.busy) {
                      // Keep the shown state equal to the SW state while another action runs.
                      event.currentTarget.checked = row.enabled;
                      return;
                    }
                    props.onChange(row.sensorId, event.currentTarget.checked);
                  }}
                />
                <label for={inputId}>
                  <span class="scope__label">{t(row.nameKey)}</span>
                  <span id={sensorDescId} class="scope__desc small muted">{t(row.descKey)}</span>
                  <span id={stateId} class="scope__desc small" data-sensor-state={row.stateKey}>{t(row.stateKey)}</span>
                </label>
              </div>
            );
          })}
        </fieldset>
      ) : null}
    </section>
  );
}
