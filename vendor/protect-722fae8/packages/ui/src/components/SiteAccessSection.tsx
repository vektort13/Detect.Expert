// Options «Доступ к сайтам» (S12 / E13-03, ADR-003 v3): the sites the extension may observe, with their state, a
// «Убрать» button per site (ui-remove-site + chrome.permissions.remove of its exact grants), all-sites access with
// «Отозвать доступ ко всем сайтам», counts of other grants and of hidden rows, and the link to Chrome's own settings.
// Managed scope makes every action read-only. After a removal focus moves to the neighbouring button, else the heading.

import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import type { SiteAccessVM } from '../view-models/site-access';

export interface SiteAccessSectionProps {
  vm: SiteAccessVM;
  busy: boolean;
  onRemove: (host: string) => Promise<boolean>;
  onRevokeAll: () => void;
  onOpenChrome: () => void;
  /** ADR-003 v4 / ADR-020 §7 (S15): the module «Защита» is on; revoking all-sites access suspends it. */
  protectOn?: boolean;
}

export const SITE_ACCESS_ID = 'site-access';
export const SITE_ACCESS_TITLE_ID = 'site-access-title';

function focusAfterRemoval(list: HTMLElement | null, index: number, heading: HTMLElement | null): void {
  window.requestAnimationFrame(() => {
    const buttons = list === null ? [] : Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-remove-site]'));
    const next = buttons[index] ?? buttons[index - 1];
    if (next !== undefined) next.focus();
    else heading?.focus();
  });
}

export function SiteAccessSection(props: SiteAccessSectionProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const vm = props.vm;
  const disabled = vm.managed;
  const nothing = vm.rows.length === 0 && !vm.allSites.granted && vm.otherGrants === 0;
  return (
    <section class="section site-access" id={SITE_ACCESS_ID} aria-labelledby={SITE_ACCESS_TITLE_ID} data-site-access="true">
      <h2 id={SITE_ACCESS_TITLE_ID} class="section__title" tabIndex={-1} ref={headingRef}>
        {t('site_access_title')}
      </h2>
      <p class="small muted">{t('site_access_desc')}</p>
      {disabled ? <p class="small muted">{t('coverage_managed_desc')}</p> : null}
      {nothing ? <p class="small" data-site-access-empty="true">{t('site_access_none')}</p> : null}
      {vm.allSites.granted ? (
        <div class="access-all">
          <p class="access-list__row">
            <span class="access-list__host">{t('site_all_sites')}</span>
            {vm.allSites.required ? <span class="small muted"> — {t('site_status_required')}</span> : null}
            {vm.allSites.observed ? <span class="small muted" data-all-sites-observed="true"> — {t('site_status_observed')}</span> : null}
          </p>
          {vm.allSites.observed ? <p class="small muted">{t('site_access_all_sites_observed')}</p> : null}
          {vm.allSites.revocable.length > 0 ? (
            <>
              {props.protectOn === true ? <p id="site-access-protect-warning" class="small" data-site-access-protect-warning="true">{t('scope_protect_revoke_warning')}</p> : null}
              <p class="actions">
                <button type="button" class="button" disabled={disabled} aria-disabled={props.busy || disabled} data-revoke-all-sites="true"
                  aria-describedby={props.protectOn === true ? 'site-access-protect-warning' : undefined}
                  onClick={() => { if (!props.busy && !disabled) props.onRevokeAll(); }}>
                  {t('action_revoke_all_sites')}
                </button>
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {vm.rows.length > 0 ? (
        <ul class="access-list" ref={listRef}>
          {vm.rows.map((row, index) => (
            <li key={row.host} class="access-list__item" data-site-row={row.host}>
              <span class="access-list__host mono" dir="ltr">{row.host}</span>
              <span class="access-list__status small muted" data-site-status={row.statusKey}>{t(row.statusKey)}</span>
              {!row.listed && row.revocable.length === 0 ? null : (
                <button
                  type="button"
                  class="button button--text"
                  data-remove-site={row.host}
                  aria-label={t('action_remove_site_named', [row.host])}
                  disabled={disabled}
                  aria-disabled={props.busy || disabled}
                  onClick={() => {
                    if (props.busy || disabled) return;
                    void props.onRemove(row.host).then((removed) => {
                      if (removed) focusAfterRemoval(listRef.current, index, headingRef.current);
                    });
                  }}
                >
                  {t('action_remove_site')}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {vm.hidden > 0 ? <p class="small muted">{t('site_access_hidden', [String(vm.hidden)])}</p> : null}
      {vm.otherGrants > 0 ? <p class="small muted">{t('site_access_other', [String(vm.otherGrants)])}</p> : null}
      <p class="actions">
        <button type="button" class="button button--text" onClick={props.onOpenChrome}>
          {t('action_open_chrome_site_access')}
        </button>
      </p>
    </section>
  );
}
