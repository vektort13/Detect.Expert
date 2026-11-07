// ADR-020 §I (S14): the letter composer of requests.html. The user picks the company, the law (remembered by the SW
// as a preference), the requests, the letter language, the observations to quote (low and unassessed are not ticked by
// default), how the company identifies them and where the letter goes; the preview is read-only. «Открыть в почте» is a
// plain mailto: link, «Скопировать текст» uses navigator.clipboard inside the click (fallback: the text is selected),
// a company form opens as a link. The extension sends nothing. The identifier and the name live only in this
// component's memory: they are never stored, never sent to the SW (the journal entry carries their kinds only) and
// never filled in by the extension.

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { JURISDICTION_LETTER_LANGS, JURISDICTION_REQUEST_KINDS, PROTECT_WIRE_LIMITS, REQUEST_JURISDICTIONS } from '@detect-expert/contracts';
import type { LocalDay, RequestDelivery, RequestJurisdiction, RequestKind, RequestLetterLang } from '@detect-expert/contracts';
import { requestFactSentence } from '@detect-expert/engine';
import { t, tm, uiLocale } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { msg } from '../../../view-models/message';
import {
  REQUEST_KIND_KEYS,
  REQUEST_LANG_KEYS,
  REQUEST_LAW_KEYS,
  composerLetter,
  composerMailto,
  composerProblem,
  composerRecipient,
  composerRequestInput,
  formatRequestDay,
  initialComposerState,
  parseRequestsJournal,
  recipientCandidates,
  requestInputKey,
  withJurisdiction,
  withSubject,
} from '../../../view-models/protect-requests';
import type { ComposerProblem, ComposerSource, ComposerState, RequestsJournalView } from '../../../view-models/protect-requests';

export interface RequestComposerProps {
  source: ComposerSource;
  today: LocalDay;
  /** Current journal revision (expectedRevision of the save). */
  revision: number;
  /** Re-reads the journal after stale-revision; the new revision or null. */
  reload: () => Promise<number | null>;
  onSaved: (journal: RequestsJournalView) => void;
  onClose: () => void;
}

const PROBLEM_KEYS: Readonly<Record<ComposerProblem, string>> = {
  law: 'protect_req_choose_law_first',
  kinds: 'protect_req_choose_kind',
  entity: 'protect_req_entity_invalid',
  identity: 'protect_req_identity_required',
  recipient: 'protect_req_recipient_invalid',
};

/** navigator.clipboard inside the user gesture; false when unavailable or refused. */
function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') return Promise.resolve(false);
    return clipboard.writeText(text).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function RequestComposer(props: RequestComposerProps): JSX.Element {
  const source = props.source;
  const locale = uiLocale();
  const [state, setState] = useState<ComposerState>(() => initialComposerState(source, locale));
  // Memory of this page only (never stored, never sent to the service worker).
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef(new Set<string>());
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const problem = composerProblem(source, state, identifier);
  const letter = useMemo(() => composerLetter(source, state, identifier, name, props.today), [source, state, identifier, name, props.today]);
  const recipient = composerRecipient(source, state);
  const mailto = composerMailto(recipient, letter, state.letterLang);
  const portal = recipient !== null && recipient.source === 'table' && recipient.channel === 'portal' ? recipient.address : null;
  const candidates = recipientCandidates(source, state);
  const kindsAllowed: readonly RequestKind[] = state.jurisdiction === null ? [] : JURISDICTION_REQUEST_KINDS[state.jurisdiction];
  const langs: readonly RequestLetterLang[] = state.jurisdiction === null ? ['ru', 'en'] : JURISDICTION_LETTER_LANGS[state.jurisdiction];

  const save = async (delivery: RequestDelivery): Promise<void> => {
    const input = composerRequestInput(source, state, identifier, name, delivery);
    if (input === null) return;
    const key = requestInputKey(input);
    if (saved.current.has(key)) return;
    saved.current.add(key);
    setBusy(true);
    let result = await protectUi.requestSave({ expectedRevision: props.revision, request: input });
    if (!result.ok && result.code === 'stale-revision') {
      const fresh = await props.reload();
      if (fresh !== null) result = await protectUi.requestSave({ expectedRevision: fresh, request: input });
    }
    setBusy(false);
    const journal = result.ok ? parseRequestsJournal(result.response) : null;
    if (journal === null) {
      saved.current.delete(key);
      setSaveNotice(t(errorMessageKey(result.ok ? 'unavailable' : result.code)));
      return;
    }
    props.onSaved(journal);
    setSaveNotice(t('protect_req_saved'));
  };

  const afterCopy = (ok: boolean, okKey: string): void => {
    if (ok) setCopyNotice(t(okKey));
    else {
      bodyRef.current?.focus();
      bodyRef.current?.select();
      setCopyNotice(t('protect_req_copy_failed'));
    }
  };

  const onCopy = (): void => {
    if (letter === null) return;
    // The clipboard call happens inside the click (user activation), before any await.
    const copied = copyText(letter.body);
    void copied.then((ok) => afterCopy(ok, 'protect_req_copied'));
    void save('copy');
  };

  const onMail = (): void => {
    if (letter === null || mailto === null) return;
    if (mailto.shortened) void copyText(letter.body).then((ok) => afterCopy(ok, 'protect_req_mailto_shortened'));
    void save('mailto');
  };

  const onPortal = (): void => {
    if (letter === null) return;
    void copyText(letter.body).then((ok) => afterCopy(ok, 'protect_req_portal_copied'));
    void save('portal');
  };

  const setJurisdiction = (value: string): void => {
    if (!(REQUEST_JURISDICTIONS as readonly string[]).includes(value)) return;
    setState((s) => withJurisdiction(source, s, value as RequestJurisdiction, locale));
  };

  const toggleKind = (kind: RequestKind, on: boolean): void => {
    setState((s) => ({ ...s, kinds: on ? [...s.kinds.filter((k) => k !== kind), kind] : s.kinds.filter((k) => k !== kind) }));
  };

  return (
    <section class="section requests-composer" aria-labelledby="requests-composer-title" data-requests-composer={source.sourceKind}>
      <h2 id="requests-composer-title" class="section__title" tabIndex={-1}>{t('protect_req_composer_title')}</h2>
      {source.sourceMissing ? <p class="state state--attention" data-requests-source-missing="true">{t('protect_req_source_missing')}</p> : null}

      <fieldset class="requests-fieldset" data-requests-subjects="true">
        <legend>{t('protect_req_subject_title')}</legend>
        {source.subjects.map((s, i) => (
          <label key={s.role + (s.domain ?? '')} class="requests-option">
            <input type="radio" name="requests-subject" checked={state.subjectIndex === i} onChange={() => setState((st) => withSubject(source, st, i))} />
            {' '}{tm(msg(s.role === 'receiver' ? 'protect_req_subject_receiver' : 'protect_req_subject_site', s.domain ?? s.entityName))}
          </label>
        ))}
        {source.subjects.length > 0 ? (
          <label class="requests-option">
            <input type="radio" name="requests-subject" checked={state.subjectIndex === -1} onChange={() => setState((st) => withSubject(source, st, -1))} />
            {' '}{t('protect_req_subject_other')}
          </label>
        ) : null}
        <label class="field">
          <span>{t('protect_req_entity_label')}</span>
          <input
            type="text"
            value={state.entityName}
            maxLength={PROTECT_WIRE_LIMITS.maxEntityNameChars}
            autocomplete="off"
            data-requests-entity="true"
            onInput={(e) => {
              const value = e.currentTarget.value;
              setState((s) => ({ ...s, entityName: value }));
            }}
          />
        </label>
      </fieldset>

      <div class="field requests-law">
        <label for="requests-law">{t('protect_req_jurisdiction_label')}</label>
        <select id="requests-law" value={state.jurisdiction ?? ''} aria-describedby="requests-law-hint" data-requests-law="true" onChange={(e) => setJurisdiction(e.currentTarget.value)}>
          <option value="" disabled={state.jurisdiction !== null}>{t('protect_req_jurisdiction_choose')}</option>
          {REQUEST_JURISDICTIONS.map((j) => (
            <option key={j} value={j}>{t(REQUEST_LAW_KEYS[j])}</option>
          ))}
        </select>
        <p id="requests-law-hint" class="small muted">{t('protect_req_jurisdiction_hint')}</p>
      </div>

      {state.jurisdiction !== null ? (
        <>
          <fieldset class="requests-fieldset" data-requests-kinds="true">
            <legend>{t('protect_req_kinds_title')}</legend>
            {kindsAllowed.map((k) => (
              <label key={k} class="requests-option">
                <input type="checkbox" checked={state.kinds.includes(k)} data-requests-kind={k} onChange={(e) => toggleKind(k, e.currentTarget.checked)} />
                {' '}{t(REQUEST_KIND_KEYS[k])}
              </label>
            ))}
          </fieldset>
          <fieldset class="requests-fieldset" data-requests-langs="true">
            <legend>{t('protect_req_lang_label')}</legend>
            {langs.map((l) => (
              <label key={l} class="requests-option">
                <input type="radio" name="requests-lang" checked={state.letterLang === l} data-requests-lang={l} onChange={() => setState((s) => ({ ...s, letterLang: l }))} />
                {' '}{t(REQUEST_LANG_KEYS[l])}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}

      {source.facts.length > 0 ? (
        <fieldset class="requests-fieldset requests-facts" data-requests-facts="true">
          <legend>{t('protect_req_facts_title')}</legend>
          <p class="small muted">{t('protect_req_facts_hint')}</p>
          {source.facts.map((f, i) => (
            <label key={String(i)} class="requests-option requests-fact" data-requests-fact={f.interpretationConfidence}>
              <input
                type="checkbox"
                checked={state.checked[i] === true}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setState((s) => ({ ...s, checked: s.checked.map((c, j) => (j === i ? on : c)) }));
                }}
              />
              <span>{requestFactSentence(f, locale)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset class="requests-fieldset" data-requests-identity="true">
        <legend>{t('protect_req_identity_title')}</legend>
        <label class="requests-option">
          <input type="radio" name="requests-identity" checked={state.identity === 'sender-address'} data-requests-identity-kind="sender-address" onChange={() => setState((s) => ({ ...s, identity: 'sender-address' }))} />
          {' '}{t('protect_req_identity_sender')}
        </label>
        <label class="requests-option">
          <input type="radio" name="requests-identity" checked={state.identity === 'typed-identifier'} data-requests-identity-kind="typed-identifier" onChange={() => setState((s) => ({ ...s, identity: 'typed-identifier' }))} />
          {' '}{t('protect_req_identity_typed')}
        </label>
        {state.identity === 'typed-identifier' ? (
          <label class="field">
            <span>{t('protect_req_identity_value_label')}</span>
            <input
              type="text"
              value={identifier}
              maxLength={PROTECT_WIRE_LIMITS.maxEmailChars}
              autocomplete="off"
              spellcheck={false}
              data-requests-identifier="true"
              onInput={(e) => setIdentifier(e.currentTarget.value)}
            />
          </label>
        ) : null}
        <label class="requests-option">
          <input type="checkbox" checked={state.includeName} data-requests-include-name="true" onChange={(e) => {
            const on = e.currentTarget.checked;
            setState((s) => ({ ...s, includeName: on }));
          }} />
          {' '}{t('protect_req_identity_name')}
        </label>
        {state.includeName ? (
          <label class="field">
            <span>{t('protect_req_name_label')}</span>
            <input
              type="text"
              value={name}
              maxLength={PROTECT_WIRE_LIMITS.maxEntityNameChars}
              autocomplete="off"
              spellcheck={false}
              data-requests-name="true"
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
        ) : null}
        <p class="small requests-warning">{t('protect_req_identity_warning')}</p>
        {state.jurisdiction === 'pdl-ru-152' ? <p class="small muted" data-requests-ru-note="true">{t('protect_req_ru_formal_note')}</p> : null}
      </fieldset>

      <fieldset class="requests-fieldset" data-requests-recipient="true">
        <legend>{t('protect_req_recipient_title')}</legend>
        {candidates.map((c) => (
          <label key={c.contactId} class="requests-option" data-requests-candidate={c.contactId}>
            <input
              type="radio"
              name="requests-recipient"
              checked={state.recipient.kind === 'table' && state.recipient.contactId === c.contactId}
              onChange={() => setState((s) => ({ ...s, recipient: { kind: 'table', contactId: c.contactId } }))}
            />
            {' '}<span class="mono" dir="ltr">{c.address}</span>
            {' '}<span class="small muted">{c.channel === 'portal' ? t('protect_req_recipient_portal') + ' · ' : ''}{tm(msg('protect_req_recipient_table', formatRequestDay(c.reviewedAt, locale)))}</span>
          </label>
        ))}
        {source.previousRecipient !== null && source.previousRecipient.source !== 'none' ? (
          <label class="requests-option">
            <input type="radio" name="requests-recipient" checked={state.recipient.kind === 'previous'} onChange={() => setState((s) => ({ ...s, recipient: { kind: 'previous' } }))} />
            {' '}<span class="mono" dir="ltr">{source.previousRecipient.address}</span>
          </label>
        ) : null}
        {candidates.length === 0 && state.jurisdiction !== null ? <p class="small muted" data-requests-recipient-unknown="true">{t('protect_req_recipient_unknown')}</p> : null}
        <label class="requests-option">
          <input type="radio" name="requests-recipient" checked={state.recipient.kind === 'manual'} data-requests-recipient-kind="manual" onChange={() => setState((s) => ({ ...s, recipient: { kind: 'manual' } }))} />
          {' '}{t('protect_req_recipient_manual')}
        </label>
        {state.recipient.kind === 'manual' ? (
          <label class="field">
            <span>{t('protect_req_recipient_manual_label')}</span>
            <input
              type="email"
              value={state.manualAddress}
              maxLength={PROTECT_WIRE_LIMITS.maxEmailChars}
              autocomplete="off"
              spellcheck={false}
              data-requests-manual-address="true"
              onInput={(e) => {
                const value = e.currentTarget.value;
                setState((s) => ({ ...s, manualAddress: value }));
              }}
            />
          </label>
        ) : null}
        <label class="requests-option">
          <input type="radio" name="requests-recipient" checked={state.recipient.kind === 'none'} data-requests-recipient-kind="none" onChange={() => setState((s) => ({ ...s, recipient: { kind: 'none' } }))} />
          {' '}{t('protect_req_recipient_none')}
        </label>
      </fieldset>

      {state.jurisdiction === 'ccpa-ca' && source.gpcAvailable ? (
        <label class="requests-option">
          <input type="checkbox" checked={state.mentionGpc} data-requests-gpc="true" onChange={(e) => {
            const on = e.currentTarget.checked;
            setState((s) => ({ ...s, mentionGpc: on }));
          }} />
          {' '}{t('protect_req_gpc_mention')}
        </label>
      ) : null}

      <div class="requests-preview" data-requests-preview={letter === null ? 'incomplete' : letter.draft ? 'draft' : 'reviewed'}>
        <h3 class="requests-preview__title">{t('protect_req_preview_title')}</h3>
        {letter === null ? (
          <p class="state" data-requests-problem={problem ?? 'unknown'}>{t(PROBLEM_KEYS[problem ?? 'law'])}</p>
        ) : (
          <>
            <label class="field">
              <span>{t('protect_req_preview_subject')}</span>
              <input type="text" readOnly value={letter.subject} data-requests-subject-line="true" />
            </label>
            <label class="field">
              <span>{t('protect_req_preview_body')}</span>
              <textarea ref={bodyRef} class="requests-preview__body" readOnly rows={16} value={letter.body} data-requests-body="true" />
            </label>
          </>
        )}
      </div>

      <p class="actions requests-actions">
        {mailto !== null && letter !== null ? (
          <a class="button button--primary" href={mailto.href} data-requests-mailto={mailto.shortened ? 'short' : 'full'} onClick={onMail}>
            {t('protect_req_open_mail')}
          </a>
        ) : null}
        {portal !== null && letter !== null ? (
          <a class="button button--primary" href={portal} target="_blank" rel="noopener noreferrer" data-requests-portal="true" onClick={onPortal}>
            {t('protect_req_open_portal')}
          </a>
        ) : null}
        <button type="button" class="button" disabled={letter === null || busy} data-requests-copy="true" onClick={onCopy}>
          {t('protect_req_copy')}
        </button>
        <button type="button" class="button button--text" data-requests-close="true" onClick={props.onClose}>
          {t('protect_req_close_composer')}
        </button>
      </p>
      {mailto !== null && mailto.shortened ? <p class="small requests-warning">{t('protect_req_mailto_long')}</p> : null}
      <ul class="small muted requests-notes">
        <li>{t('protect_req_clipboard_note')}</li>
        <li>{t('protect_req_mailto_note')}</li>
      </ul>
      <p class="small requests-notice" aria-live="polite" data-requests-notice="true">
        {copyNotice !== null ? <span data-requests-copy-notice="true">{copyNotice} </span> : null}
        {saveNotice !== null ? <span data-requests-save-notice="true">{saveNotice}</span> : null}
      </p>
    </section>
  );
}
