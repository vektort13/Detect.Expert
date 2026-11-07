// ADR-020 §I (S14): requests.html — «Запросы о персональных данных». The extension drafts a letter on this device; the
// user sends it (mail program, clipboard or the company's form); nothing is sent by the extension (CSP connect-src
// 'none'). Layout: title, the draft badge while a template is unreviewed, «не юридическая консультация», then the
// composer (only with `#new=…` and the module active) and the journal. While the module is not active the page is
// read-only (view, export, deletion). The identifier and the name typed here live only in this page's memory.

import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { REQUEST_JURISDICTIONS } from '@detect-expert/contracts';
import type { DeletionRequestRecord, ProtectState } from '@detect-expert/contracts';
import { REQUEST_TEMPLATES, parseRequestPageHash } from '@detect-expert/engine';
import type { RequestPageSource } from '@detect-expert/engine';
import { t } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import {
  composerSourceFromDraft,
  composerSourceFromRecord,
  localToday,
  parseRequestDraft,
  parseRequestsJournal,
  requestsComposerAvailable,
} from '../../../view-models/protect-requests';
import type { ComposerSource, RequestsJournalView } from '../../../view-models/protect-requests';
import { RequestComposer } from './RequestComposer';
import { RequestJournal } from './RequestJournal';

type Load<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; key: string };

function anyTemplateUnreviewed(): boolean {
  return REQUEST_JURISDICTIONS.some((j) => REQUEST_TEMPLATES[j].legalReviewStatus !== 'reviewed');
}

export function RequestsApp(): JSX.Element {
  const [state, setState] = useState<Load<ProtectState>>({ status: 'loading' });
  const [journal, setJournal] = useState<Load<RequestsJournalView>>({ status: 'loading' });
  const [composer, setComposer] = useState<{ key: number; source: ComposerSource } | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pageSource] = useState<RequestPageSource | null>(() => (typeof location === 'undefined' ? null : parseRequestPageHash(location.hash)));
  const today = localToday() ?? '2026-01-01';
  const revision = useRef(0);
  const composerKey = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const applyJournal = useCallback((j: RequestsJournalView): void => {
    revision.current = j.revision;
    setJournal({ status: 'ready', value: j });
  }, []);

  const loadJournal = useCallback(async (): Promise<number | null> => {
    const result = await protectUi.requestsGet({ view: 'full' });
    const parsed = result.ok ? parseRequestsJournal(result.response) : null;
    if (parsed === null) {
      setJournal({ status: 'error', key: errorMessageKey(result.ok ? 'unavailable' : result.code) });
      return null;
    }
    applyJournal(parsed);
    return parsed.revision;
  }, [applyJournal]);

  useEffect(() => {
    let live = true;
    void protectUi.getState().then((result) => {
      if (!live) return;
      setState(result.ok && result.response.type === 'protect-state' ? { status: 'ready', value: result.response.state } : { status: 'error', key: errorMessageKey(result.ok ? 'unavailable' : result.code) });
    });
    void loadJournal();
    return () => {
      live = false;
    };
  }, [loadJournal]);

  const moduleState = state.status === 'ready' ? state.value : null;
  const editable = requestsComposerAvailable(moduleState);
  const gpcAvailable = moduleState?.features.includes('gpc') === true;

  // The composer of `#new=…`: one draft request, only while the module is active.
  useEffect(() => {
    if (!editable || pageSource === null) return;
    let live = true;
    void protectUi.requestDraft(pageSource.sourceKind === 'manual' ? { sourceKind: 'manual' } : { sourceKind: pageSource.sourceKind, recordId: pageSource.recordId }).then((result) => {
      if (!live) return;
      const draft = result.ok ? parseRequestDraft(result.response) : null;
      if (draft === null) {
        setComposerError(errorMessageKey(result.ok ? 'unavailable' : result.code));
        return;
      }
      composerKey.current++;
      setComposer({ key: composerKey.current, source: composerSourceFromDraft(draft) });
    });
    return () => {
      live = false;
    };
  }, [editable, pageSource]);

  const repeat = (record: DeletionRequestRecord): void => {
    composerKey.current++;
    setComposer({ key: composerKey.current, source: composerSourceFromRecord(record, gpcAvailable) });
    setTimeout(() => document.getElementById('requests-composer-title')?.focus(), 0);
  };

  const startManual = (): void => {
    void protectUi.requestDraft({ sourceKind: 'manual' }).then((result) => {
      const draft = result.ok ? parseRequestDraft(result.response) : null;
      if (draft === null) {
        setComposerError(errorMessageKey(result.ok ? 'unavailable' : result.code));
        return;
      }
      composerKey.current++;
      setComposer({ key: composerKey.current, source: composerSourceFromDraft(draft) });
      setTimeout(() => document.getElementById('requests-composer-title')?.focus(), 0);
    });
  };

  const moduleOff = state.status === 'ready' && !editable;
  const journalDisabled = journal.status === 'error' && journal.key === errorMessageKey('module-disabled');

  return (
    <main class="app app--requests" data-requests-app={editable ? 'editable' : state.status === 'ready' ? 'read-only' : 'loading'}>
      <header class="requests-header">
        <h1 ref={titleRef} class="app__title">{t('protect_req_page_title')}</h1>
        {anyTemplateUnreviewed() ? <p class="pill pill--attention requests-draft-badge" data-requests-draft-badge="true">{t('protect_req_draft_badge')}</p> : null}
        <p>{t('protect_req_intro')}</p>
        <p class="small muted">{t('protect_req_not_legal_advice')}</p>
      </header>
      {moduleOff ? <p class="state state--attention" data-requests-readonly="true">{t('protect_req_readonly')}</p> : null}
      {state.status === 'error' ? <p class="state state--attention">{t(state.key)}</p> : null}
      {composerError !== null ? <p class="state state--attention" data-requests-composer-error="true">{t(composerError)}</p> : null}
      {editable && composer !== null && journal.status === 'ready' ? (
        <RequestComposer
          key={composer.key}
          source={composer.source}
          today={today}
          revision={journal.value.revision}
          reload={loadJournal}
          onSaved={applyJournal}
          onClose={() => {
            setComposer(null);
            if (location.hash !== '') history.replaceState(null, '', location.pathname);
            titleRef.current?.focus();
          }}
        />
      ) : null}
      {editable && composer === null ? (
        <p class="actions">
          <button type="button" class="button" data-requests-new="manual" onClick={startManual}>{t('protect_req_new_manual')}</button>
        </p>
      ) : null}
      {journal.status === 'ready' ? (
        <RequestJournal journal={journal.value} today={today} editable={editable} onChanged={applyJournal} reload={loadJournal} onRepeat={repeat} />
      ) : journal.status === 'loading' ? (
        <p class="small muted">{t('protect_req_loading')}</p>
      ) : journalDisabled ? (
        <p class="small muted" data-requests-module-off="true">{t('protect_req_module_off')}</p>
      ) : (
        <p class="state state--attention">{t(journal.key)}</p>
      )}
    </main>
  );
}
