// ADR-078: dated external catalogue associations never enter live detector results or their counters.
import { lookupAutosurfSiteSystems, siteSystemsHostname } from './autosurf-site-systems.js';
import { createSystemMarkUi } from './system-mark-ui.js';
import { AUTOSURF_SITES_DATA } from './autosurf-sites-data.js';

function loadPackagedCatalog() {
  // Static extension-owned data; indexing starts only when a report has a host.
  return AUTOSURF_SITES_DATA;
}

export function createSiteSystemsUi({ h, useState, useEffect, useLocale, translate, loadCatalog = loadPackagedCatalog }) {
  const { SystemLabel } = createSystemMarkUi({ h });
  function SiteSystemsCatalog({ host, visible = true, id = 'site-systems-catalog' }) {
    const locale = useLocale();
    const hostname = siteSystemsHostname(host);
    const [result, setResult] = useState(null);
    useEffect(() => {
      let current = true;
      if (visible && hostname) {
        Promise.resolve().then(loadCatalog).then(catalog => {
          const association = lookupAutosurfSiteSystems(catalog, hostname);
          if (current) setResult({ host: hostname, association });
        }).catch(() => { if (current) setResult(null); });
      }
      return () => { current = false; };
    }, [hostname, visible]);
    const association = visible && result?.host === hostname ? result.association : null;
    if (!association) return null;
    let date = association.snapshotAt;
    try {
      const language = ({ zh_CN: 'zh-CN', pt_BR: 'pt-BR', yue: 'zh-CN', wuu: 'zh-CN' })[locale] ?? locale ?? 'en';
      date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(association.snapshotAt + 'T00:00:00Z'));
    } catch { /* A valid catalogue date remains readable when a locale is unavailable. */ }
    const sourceTitle = /^site-catalogue-\d{8}$/.test(association.source.id) ? translate('autosurf_sites_catalog') : association.source.title;
    // ADR-103 (owner): catalogue systems sit in the recognized services list as cards. Each card names
    // its dated source; they are not live vendor results (no data-vendor-id) and never enter counters.
    return h('div', { class: 'cards site-systems-catalog', 'data-site-systems-catalog': association.host, id, children: association.systems.map(system => h('article', {
      class: 'card--vendor card--catalog', 'data-site-system-association': system.id, children: [
        h('h3', { dir: 'auto', children: h(system.sourceUrl ? 'a' : 'span', { class: 'site-systems-catalog__system', ...(system.sourceUrl ? { href: system.sourceUrl, target: '_blank', rel: 'noopener noreferrer' } : {}), children:
          h(SystemLabel, { name: system.name, identity: system.id }) }) }),
        h('p', { class: 'small muted site-systems-catalog__source', children: [
          association.source.url ? h('a', { href: association.source.url, target: '_blank', rel: 'noopener noreferrer', children: sourceTitle }) : h('span', { children: sourceTitle }),
          ' · ', h('time', { dateTime: association.snapshotAt, children: date })
        ] })
      ] }, system.id)) });
  }
  return { SiteSystemsCatalog };
}
