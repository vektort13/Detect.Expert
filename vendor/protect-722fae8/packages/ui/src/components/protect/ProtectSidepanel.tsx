// ADR-020 «Защита» (S06): the side-panel tab «Защита», shown only while the module is not off. Module status and
// coverage first, then the evidence details (S07) and the session-recording details (S11). The tab «Кто узнаёт»
// (history, S12) is a separate panel of SidepanelApp.

import type { JSX } from 'preact';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { t } from '../../i18n';
import { EvidenceDetails } from './leaks/EvidenceDetails';
import { ProtectStatus } from './ProtectPopupArea';
import { ReplayDetails } from './replay/ReplayDetails';

/** What every side-panel slot receives (lanes S07, S11, S12, S14). */
export interface ProtectPanelSlotProps {
  state: ProtectState;
  report: ProtectProjection | null;
  tabId: number | null;
  refreshState: () => Promise<void>;
  refreshReport: () => Promise<void>;
}

export function ProtectSidepanel(props: ProtectPanelSlotProps): JSX.Element {
  return (
    <section class="section" aria-labelledby="panel-protect-title" data-protect-panel="true">
      <h2 id="panel-protect-title" class="section__title">
        {t('protect_title')}
      </h2>
      <ProtectStatus id="panel-protect-status" state={props.state} report={props.report} settingsLink={false} />
      <EvidenceDetails {...props} />
      <ReplayDetails {...props} />
      <p class="small muted">{t('protect_no_verdict')}</p>
    </section>
  );
}
