// ADR-020 «Защита» (S06): the module's area of the popup, first after Header / Notice, mounted only while the module is
// not off (protectSurfaceVisible). Order follows the firewall prototype: firewall card (S09), transfers of typed data
// (S07), session recording (S11), GPC (S13), data-request reminder (S14), then the module status line with its
// coverage on this page and the link to the module settings (options.html#protect). Palette: ui.css tokens only.
// No action here widens the module: enable / features / un-excluding a site exist only in Options.

import type { JSX } from 'preact';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { t, tm } from '../../i18n';
import { openProtectOptions } from '../../messaging';
import { protectStatusView } from '../../view-models/protect';
import { EvidenceList } from './leaks/EvidenceList';
import { FirewallCard } from './firewall/FirewallCard';
import { GpcSiteLine } from './gpc/GpcSiteLine';
import { ReplayRow } from './replay/ReplayRow';
import { RequestsReminder } from './requests/RequestsReminder';

/** What every popup slot receives (lanes S07, S09, S11, S13, S14). */
export interface ProtectPopupSlotProps {
  state: ProtectState;
  /** Projection of the shown tab; null until loaded or when the module has no data for it. */
  report: ProtectProjection | null;
  tabId: number | null;
  refreshState: () => Promise<void>;
  refreshReport: () => Promise<void>;
  openSidePanel: () => void;
}

export interface ProtectStatusProps {
  id: string;
  state: ProtectState;
  report: ProtectProjection | null;
  /** Popup: link to options.html#protect. */
  settingsLink: boolean;
}

/** Module state + coverage of the shown document (never a verdict about the site). */
export function ProtectStatus(props: ProtectStatusProps): JSX.Element {
  const vm = protectStatusView(props.state, props.report);
  const tone = vm.tone === 'attention' ? ' state--attention' : '';
  return (
    <div class={'state' + tone} id={props.id} data-protect-status={props.state.state}>
      <p class="state__line">{tm(vm.state)}</p>
      {vm.coverage !== null ? <p class="state__line small">{tm(vm.coverage)}</p> : null}
      {props.settingsLink ? (
        <p class="actions">
          <button type="button" class="button button--text" onClick={() => void openProtectOptions('protect')}>
            {t('protect_settings_link')}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function ProtectPopupArea(props: ProtectPopupSlotProps): JSX.Element {
  return (
    <section class="section" aria-labelledby="popup-protect-title" data-protect-area="true">
      <h2 id="popup-protect-title" class="sr-only">
        {t('protect_title')}
      </h2>
      <FirewallCard {...props} />
      <EvidenceList {...props} />
      <ReplayRow {...props} />
      <GpcSiteLine {...props} />
      <RequestsReminder {...props} />
      <ProtectStatus id="popup-protect-status" state={props.state} report={props.report} settingsLink={true} />
    </section>
  );
}
