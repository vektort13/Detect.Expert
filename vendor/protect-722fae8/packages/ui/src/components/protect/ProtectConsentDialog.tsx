// ADR-020 §6 (S06): the consent screen of the module «Защита». Modal <dialog> as in ConfirmDialog: mounted only while
// open, initial focus on the heading, Tab stays inside, Escape and «Отмена» cancel. Seven text blocks (what is read,
// what is never read, what may change on sites, what is stored, Chrome permissions, limits, no server), the features
// (value-match, firewall and session-replay ticked; history and gpc not), the blocking mode (normal) and the required
// acknowledgement. The confirm button stays focusable with aria-disabled and a visible reason until the box is ticked.
// Its click calls `onConfirm` synchronously: the page asks Chrome for the permissions inside that gesture.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PROTECT_FEATURES, PROTECT_PRESETS } from '@detect-expert/contracts';
import type { ProtectFeature, ProtectPreset, ProtectState } from '@detect-expert/contracts';
import { t, tm } from '../../i18n';
import type { Message } from '../../view-models/message';
import { PROTECT_FEATURE_KEYS, PROTECT_PRESET_KEYS, consentView, initialConsentDraft, toggleFeature } from '../../view-models/protect';
import type { ConsentDraft } from '../../view-models/protect';

export interface ProtectConsentDialogProps {
  id: string;
  /** Current module state: a renewed consent starts from the stored features and mode. */
  state: ProtectState | null;
  busy: boolean;
  /** Result of the last attempt (for example «Chrome не выдал разрешения»), shown inside the dialog. */
  error: Message | null;
  /** Called synchronously from the click; must request the Chrome permissions before any await. */
  onConfirm: (features: ProtectFeature[], preset: ProtectPreset) => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

export function ProtectConsentDialog(props: ProtectConsentDialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef(false);
  const [draft, setDraft] = useState<ConsentDraft>(() => initialConsentDraft(props.state));
  const vm = consentView(draft);
  const titleId = props.id + '-title';
  const introId = props.id + '-intro';
  const hintId = props.id + '-hint';
  const blocked = vm.confirmDisabled || props.busy;

  const cancel = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    const dialog = ref.current;
    try {
      if (dialog !== null && dialog.open) dialog.close();
    } catch {
      // already detached
    }
    props.onCancel();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (!dialog.open) {
      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    titleRef.current?.focus();
    return () => {
      doneRef.current = true;
      try {
        if (dialog.open) dialog.close();
      } catch {
        // already detached
      }
    };
  }, []);

  /** Focus trap: Tab from the last control goes to the first one and back (the heading counts as the start). */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const dialog = ref.current;
    if (dialog === null) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const confirm = (): void => {
    if (blocked) {
      hintRef.current?.focus();
      return;
    }
    props.onConfirm([...draft.features], draft.preset);
  };

  const block = (titleKey: string | null, keys: ReadonlyArray<string>, n: number): JSX.Element => (
    <section class="section" aria-labelledby={titleKey === null ? undefined : props.id + '-block-' + String(n)} data-consent-block={String(n)}>
      {titleKey !== null ? <h3 id={props.id + '-block-' + String(n)} class="section__title">{t(titleKey)}</h3> : null}
      {keys.map((key) => <p key={key}>{t(key)}</p>)}
    </section>
  );

  return (
    <dialog
      ref={ref}
      id={props.id}
      class="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={introId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClose={cancel}
    >
      <div class="dialog__body">
        <h2 id={titleId} ref={titleRef} class="section__title" tabIndex={-1}>
          {t('protect_consent_title')}
        </h2>
        <p id={introId}>{t('protect_consent_intro')}</p>
        {block('protect_consent_reads_title', ['protect_consent_reads', 'protect_consent_bodies'], 1)}
        {block('protect_consent_never_title', ['protect_consent_never'], 2)}
        {block('protect_consent_changes_title', ['protect_consent_blocking', 'protect_consent_gpc', 'protect_consent_detectable'], 3)}
        {block('protect_consent_stored_title', ['protect_consent_stored'], 4)}
        {block('protect_consent_permissions_title', ['protect_consent_permissions'], 5)}
        {block(null, ['protect_consent_limits'], 6)}
        {block(null, ['protect_consent_no_server'], 7)}

        <fieldset class="scope__fieldset">
          <legend>{t('protect_features_title')}</legend>
          {PROTECT_FEATURES.map((feature) => (
            <div key={feature} class="scope__option">
              <input
                type="checkbox"
                id={props.id + '-feature-' + feature}
                checked={draft.features.includes(feature)}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  setDraft((d) => ({ ...d, features: toggleFeature(d.features, feature, on) }));
                }}
              />
              <label for={props.id + '-feature-' + feature}>{t(PROTECT_FEATURE_KEYS[feature])}</label>
            </div>
          ))}
        </fieldset>

        <fieldset class="scope__fieldset">
          <legend>{t('protect_preset_title')}</legend>
          {PROTECT_PRESETS.map((preset) => (
            <div key={preset} class="scope__option">
              <input
                type="radio"
                name={props.id + '-preset'}
                id={props.id + '-preset-' + preset}
                checked={draft.preset === preset}
                aria-describedby={preset === 'strict' ? props.id + '-strict-warning' : undefined}
                onChange={() => setDraft((d) => ({ ...d, preset }))}
              />
              <label for={props.id + '-preset-' + preset}>{t(PROTECT_PRESET_KEYS[preset])}</label>
            </div>
          ))}
          {/* Review TRUTH-06 (ADR-020 §3): strict is chosen only with the warning in view. */}
          <p id={props.id + '-strict-warning'} class="small fw-mode__warning" data-protect-strict-warning="">
            {t('fw_mode_strict_warning')}
          </p>
        </fieldset>

        <div class="scope__option">
          <input
            type="checkbox"
            id={props.id + '-ack'}
            checked={draft.ack}
            onChange={(event) => {
              const ack = event.currentTarget.checked;
              setDraft((d) => ({ ...d, ack }));
            }}
          />
          <label for={props.id + '-ack'} class="scope__label">{t('protect_consent_ack')}</label>
        </div>

        <div aria-live="polite" aria-atomic="true" class={props.error === null ? undefined : 'state state--attention'} data-consent-error="true">
          {props.error === null ? '' : tm(props.error)}
        </div>

        <div class="actions">
          <button type="button" class="button" onClick={cancel}>
            {t('action_cancel')}
          </button>
          <button
            type="button"
            class={blocked ? 'button' : 'button button--primary'}
            aria-disabled={blocked}
            aria-busy={props.busy}
            aria-describedby={vm.hintKey === null ? undefined : hintId}
            onClick={confirm}
            data-consent-confirm="true"
          >
            {t('protect_consent_confirm')}
          </button>
          {vm.hintKey !== null ? (
            <p id={hintId} ref={hintRef} class="small actions__reason" tabIndex={-1}>
              {t(vm.hintKey)}
            </p>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
