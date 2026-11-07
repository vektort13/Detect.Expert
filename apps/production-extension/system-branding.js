// ADR-034/078: exact system identities and packaged presentation assets only.
import { SYSTEM_BRANDS } from './system-branding-data.js';

export { SYSTEM_BRANDS };

const identities = new Map();
for (const entry of SYSTEM_BRANDS) {
  const mark = Object.freeze({ id: entry.id, name: entry.name, asset: entry.asset,
    src: new URL('./icons/' + entry.asset, import.meta.url).href,
    kind: entry.kind, brandId: entry.brandId ?? null });
  for (const alias of [entry.id, entry.name, ...(entry.aliases ?? [])]) identities.set(alias.trim().toLowerCase(), mark);
}

export function systemBrand(labelOrId) {
  if (typeof labelOrId !== 'string' || labelOrId.length > 256) return null;
  return identities.get(labelOrId.trim().toLowerCase()) ?? null;
}
