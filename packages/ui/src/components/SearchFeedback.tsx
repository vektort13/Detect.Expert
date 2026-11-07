// P08 / F052: debounce typing and announce the latest result at most once per two seconds.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ANNOUNCE_MIN_INTERVAL_MS } from '../view-models/announce';

export interface SearchFeedbackProps {
  id: string;
  query: string;
  active: boolean;
  count: number;
  label: string;
  unavailable?: boolean;
}

export function SearchFeedback(props: SearchFeedbackProps) {
  const [text, setText] = useState('');
  const lastAt = useRef<number | null>(null);
  const query = props.query.trim();
  const message = !props.active || query === '' ? '' :
    t('search_label') + ': ' + query + '. ' +
    (props.unavailable === true ? t('counts_unavailable') : props.count === 0 ? t('search_empty') : props.label + ': ' + String(props.count));
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
