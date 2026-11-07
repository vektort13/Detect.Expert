// In-memory search box (side panel): filters techniques, rules and vendors by substring.

import { t } from '../i18n';

export interface SearchBoxProps {
  id: string;
  describedBy?: string;
  value: string;
  onInput: (value: string) => void;
}

export function SearchBox(props: SearchBoxProps) {
  return (
    <div class="field search">
      <label for={props.id}>{t('search_label')}</label>
      <input
        id={props.id}
        aria-describedby={props.describedBy}
        type="search"
        dir="auto"
        autocomplete="off"
        spellcheck={false}
        placeholder={t('search_placeholder')}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}
