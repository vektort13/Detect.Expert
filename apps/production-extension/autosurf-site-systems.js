// ADR-078 / REQ-008/010: an exact-host catalogue association is separate from observed vendor evidence.
import { validateAutosurfSitesData } from './autosurf-sites.js';

const catalogs = new WeakMap(), indexes = new WeakMap();
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Accept only a hostname; URLs, paths, ports and parent-domain inference are excluded. */
export function siteSystemsHostname(value) {
  if (typeof value !== 'string' || value.length > 254) return null;
  const hostname = value.toLowerCase().replace(/\.$/, '');
  return HOST.test(hostname) && !/^[0-9.]+$/.test(hostname) ? hostname : null;
}

/** Uses the same checked static catalogue as site discovery, without changing a report. */
export function lookupAutosurfSiteSystems(value, host) {
  const hostname = siteSystemsHostname(host);
  if (hostname === null || !value || typeof value !== 'object') return null;
  let data = catalogs.get(value);
  if (!data) {
    // Old catalogues contain no associations. Avoid building their full search index in the inspector.
    if (!Object.getOwnPropertyDescriptor(value, 'trackingSystems')?.value?.length) return null;
    data = validateAutosurfSitesData(value);
    catalogs.set(value, data); catalogs.set(data, data);
  }
  if (!data.trackingSourceId || !data.trackingSnapshotAt) return null;
  let index = indexes.get(data);
  if (!index) {
    const source = data.sources.find(item => item.id === data.trackingSourceId);
    if (!source) return null;
    const systems = new Map(data.trackingSystems.map(system => [system.id, system]));
    index = new Map();
    for (const site of data.sites) {
      if (!site.trackingSystems.length) continue;
      index.set(site.id, Object.freeze({ host: site.id, revision: data.revision, snapshotAt: data.trackingSnapshotAt,
        source, systems: Object.freeze(site.trackingSystems.map(id => systems.get(id))) }));
    }
    indexes.set(data, index);
  }
  return index.get(hostname) ?? null;
}
