// ADR-062: the original consent copy and choices, displayed in the Options document.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PROTECT_FEATURES, PROTECT_PRESETS } from '@detect-expert/contracts';
import type { ProtectState } from '@detect-expert/contracts';
import type { ProtectConsentDialogProps } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/ProtectConsentDialog';
import { PROTECT_FEATURE_KEYS, PROTECT_PRESET_KEYS, consentView, initialConsentDraft, toggleFeature } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import type { ConsentDraft } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import { t, tm } from './i18n-shim';

/** OFF with saved choices retains those choices; the acknowledgement is always a fresh explicit input. */
export function inlineConsentDraft(state: ProtectState | null): ConsentDraft {
  const draft = initialConsentDraft(state);
  return state !== null && state.features.length > 0 ? { features: [...state.features], preset: state.preset, ack: false } : draft;
}

export function InlineProtectConsent(props: ProtectConsentDialogProps): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null), hintRef = useRef<HTMLParagraphElement>(null);
  const [draft, setDraft] = useState<ConsentDraft>(() => inlineConsentDraft(props.state));
  const vm = consentView(draft), policyBlocked = props.state?.organizationDisabled === true || props.state?.organizationPolicyInvalid === true;
  const blocked = vm.confirmDisabled || props.busy || policyBlocked;
  const titleId = props.id + '-title', introId = props.id + '-intro', hintId = props.id + '-hint';
  useEffect(() => { titleRef.current?.focus(); }, []);
  const confirm = (): void => {
    if (blocked) { hintRef.current?.focus(); return; }
    // The parent's handler calls session.enable before any await, retaining this trusted gesture.
    props.onConfirm([...draft.features], draft.preset);
  };
  const block = (titleKey: string | null, keys: ReadonlyArray<string>, n: number): JSX.Element => (
    <section class="section" aria-labelledby={titleKey === null ? undefined : props.id + '-block-' + String(n)} data-consent-block={String(n)}>
      {titleKey !== null ? <h3 id={props.id + '-block-' + String(n)} class="section__title">{t(titleKey)}</h3> : null}
      {keys.map(key => <p key={key}>{t(key)}</p>)}
    </section>
  );
  return (
    <section class="protect-inline-consent" id={props.id} aria-labelledby={titleId} aria-describedby={introId} aria-busy={props.busy} data-protect-inline-consent="true">
      <h3 id={titleId} ref={titleRef} class="section__title" tabIndex={-1}>{t('protect_consent_title')}</h3>
      <p id={introId}>{t('protect_consent_intro')}</p>
      <div class="protect-inline-consent__copy">
        {block('protect_consent_reads_title', ['protect_consent_reads', 'protect_consent_bodies'], 1)}
        {block('protect_consent_never_title', ['protect_consent_never'], 2)}
        {block('protect_consent_changes_title', ['protect_consent_blocking', 'protect_consent_gpc', 'protect_consent_detectable'], 3)}
        {block('protect_consent_stored_title', ['protect_consent_stored'], 4)}
        {block('protect_consent_permissions_title', ['protect_consent_permissions'], 5)}
        {block(null, ['protect_consent_limits'], 6)}
        {block(null, ['protect_consent_no_server'], 7)}
      </div>
      <fieldset class="scope__fieldset" disabled={props.busy || policyBlocked} data-protect-consent-features="true">
        <legend>{t('protect_features_title')}</legend>
        {PROTECT_FEATURES.map(feature => (
          <div key={feature} class="scope__option">
            <input type="checkbox" id={props.id + '-feature-' + feature} checked={draft.features.includes(feature)} onChange={event => {
              if (props.busy || policyBlocked) return;
              const on = event.currentTarget.checked;
              setDraft(current => ({ ...current, features: toggleFeature(current.features, feature, on) }));
            }} />
            <label for={props.id + '-feature-' + feature}>{t(PROTECT_FEATURE_KEYS[feature])}</label>
          </div>
        ))}
      </fieldset>
      <fieldset class="scope__fieldset" disabled={props.busy || policyBlocked} data-protect-consent-presets="true">
        <legend>{t('protect_preset_title')}</legend>
        {PROTECT_PRESETS.map(preset => (
          <div key={preset} class="scope__option">
            <input type="radio" name={props.id + '-preset'} id={props.id + '-preset-' + preset} checked={draft.preset === preset}
              aria-describedby={preset === 'strict' ? props.id + '-strict-warning' : undefined} onChange={() => { if (!props.busy && !policyBlocked) setDraft(current => ({ ...current, preset })); }} />
            <label for={props.id + '-preset-' + preset}>{t(PROTECT_PRESET_KEYS[preset])}</label>
          </div>
        ))}
        <p id={props.id + '-strict-warning'} class="small fw-mode__warning" data-protect-strict-warning="">{t('fw_mode_strict_warning')}</p>
      </fieldset>
      <div class="scope__option protect-inline-consent__ack">
        <input type="checkbox" id={props.id + '-ack'} checked={draft.ack} disabled={props.busy || policyBlocked} onChange={event => {
          if (props.busy || policyBlocked) return;
          const ack = event.currentTarget.checked; setDraft(current => ({ ...current, ack }));
        }} />
        <label for={props.id + '-ack'} class="scope__label">{t('protect_consent_ack')}</label>
      </div>
      <div aria-live="polite" aria-atomic="true" class={props.error === null ? undefined : 'state state--attention'} data-consent-error="true">{props.error === null ? '' : tm(props.error)}</div>
      <div class="actions">
        <button type="button" class="button" disabled={props.busy} onClick={() => { if (!props.busy) props.onCancel(); }} data-consent-cancel="true">{t('action_cancel')}</button>
        <button type="button" class={blocked ? 'button' : 'button button--primary'} aria-disabled={blocked} aria-busy={props.busy}
          aria-describedby={vm.hintKey === null ? undefined : hintId} onClick={confirm} data-consent-confirm="true">{t('protect_consent_confirm')}</button>
        {vm.hintKey !== null ? <p id={hintId} ref={hintRef} class="small actions__reason" tabIndex={-1}>{t(vm.hintKey)}</p> : null}
      </div>
    </section>
  );
}
