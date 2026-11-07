// P08 / F052: debounce typing and announce the latest result at most once per two seconds.
// S13 (E13-02): the same persistent polite region also announces the side-panel filters:
// `[search_label: q. ] + (count 0 ? (filterActive ? filter_empty : search_empty) : summary)`.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ANNOUNCE_MIN_INTERVAL_MS } from '../view-models/announce';

export interface SearchFeedbackProps {
  id: string;
  query: string;
  active: boolean;
  count: number;
  /** Result text when count > 0 (techniques: «Показано N из M»; sources: label and count). */
  summary: string;
  /** Field filters narrow the result too: announce even without a query, and say «reset the filters» on 0. */
  filterActive?: boolean;
  unavailable?: boolean;
}

export function SearchFeedback(props: SearchFeedbackProps) {
  const [text, setText] = useState('');
  const lastAt = useRef<number | null>(null);
  const query = props.query.trim();
  const filterActive = props.filterActive === true;
  const message = !props.active || (query === '' && !filterActive) ? '' :
    (query === '' ? '' : t('search_label') + ': ' + query + '. ') +
    (props.unavailable === true ? t('counts_unavailable') : props.count === 0 ? t(filterActive ? 'filter_empty' : 'search_empty') : props.summary);
  useEffect(() => {
    if (message === '') {
      setText('');
      return;
    }
    const delay = Math.max(500, lastAt.current === null ? 0 : ANNOUNCE_MIN_INTERVAL_MS - (Date.now() - lastAt.current));
    const timer = window.setTimeout(() => {
      lastAt.current = Date.now();
      setText(message);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [message]);
  return <span id={props.id} class="sr-only" role="status" aria-live="polite" aria-atomic="true">{text}</span>;
}
