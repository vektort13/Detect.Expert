// ADR-020 §D, §11 (S09): the outcome of a decision, shown instead of the decided card. Focus moves to its heading
// (tabIndex -1). «Следующие запросы будут остановлены» only for receivers whose rule Chrome applied (ruleApplied);
// otherwise the error text says the rule did not apply (.state--error), with the SP-1 restart hint when relevant.
// «Отменить решение» sends ui-protect-undo.

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t, tm } from '../../../i18n';
import type { FirewallResolvedVM } from '../../../view-models/protect-firewall';

export const FIREWALL_RESOLVED_TITLE_ID = 'fw-resolved-title';

export interface FirewallResolvedProps {
  vm: FirewallResolvedVM;
  busy: boolean;
  onUndo: () => void;
  onClose: () => void;
}

export function FirewallResolved(props: FirewallResolvedProps): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const { vm } = props;
  return (
    <section class="fw-card fw-resolved" aria-labelledby={FIREWALL_RESOLVED_TITLE_ID} data-fw-resolved={vm.tone}>
      <div class={'state fw-resolved__state' + (vm.tone === 'error' ? ' state--error' : '')}>
        <h2 ref={titleRef} id={FIREWALL_RESOLVED_TITLE_ID} class="state__title fw-resolved__title" tabIndex={-1}>
          {tm(vm.title)}
        </h2>
        {vm.lines.map((line, i) => (
          <p key={String(i)} class="state__line">
            {tm(line)}
          </p>
        ))}
      </div>
      <p class="fw-resolved__actions">
        {vm.undo ? (
          <button type="button" class="button" aria-busy={props.busy} data-fw-undo="true" onClick={() => props.onUndo()}>
            {t('fw_action_undo')}
          </button>
        ) : null}
        <button type="button" class="button button--text" onClick={() => props.onClose()}>
          {t('fw_action_ack')}
        </button>
      </p>
    </section>
  );
}
