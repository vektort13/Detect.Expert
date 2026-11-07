// ADR-020 «Защита» (S06): the Options tab «Защита». Order: the module section (S06), firewall rules (S09, #firewall),
// GPC (S13), history settings (S12, #history), data requests (S14, #requests). The lane slots are stubs until their
// steps land; each receives the module state and a way to re-read it.

import type { JSX } from 'preact';
import type { ProtectState } from '@detect-expert/contracts';
import type { ProtectStateSession } from '../../app/useProtectState';
import { FirewallRulesPanel } from './firewall/FirewallRulesPanel';
import { GpcSection } from './gpc/GpcSection';
import { HistorySettings } from './history/HistorySettings';
import { ProtectSection } from './ProtectSection';
import type { ProtectSectionProps } from './ProtectSection';
import { RequestsOptionsSection } from './requests/RequestsOptionsSection';

/** What every Options slot receives (lanes S09, S12, S13, S14). */
export interface ProtectOptionsSlotProps {
  state: ProtectState;
  busy: boolean;
  refreshState: () => Promise<void>;
}

export interface ProtectOptionsPanelProps {
  session: ProtectStateSession;
  state: ProtectState;
  onLayoutAction?: ProtectSectionProps['onLayoutAction'];
}

export function ProtectOptionsPanel(props: ProtectOptionsPanelProps): JSX.Element {
  const slot: ProtectOptionsSlotProps = { state: props.state, busy: props.session.busy, refreshState: props.session.refresh };
  return (
    <>
      <ProtectSection
        session={props.session}
        state={props.state}
        mode="full"
        {...(props.onLayoutAction === undefined ? {} : { onLayoutAction: props.onLayoutAction })}
      />
      <FirewallRulesPanel {...slot} />
      <GpcSection {...slot} />
      <HistorySettings {...slot} />
      <RequestsOptionsSection {...slot} />
    </>
  );
}
