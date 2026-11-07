// ADR-020 §7 (S04): permissions of the module «Защита». The SW never requests a permission (that needs a user gesture
// in the Options page, S06); it only checks them and reacts to grants and removals. The module needs the broad host
// grant (http/https all sites: SP-9, DNR and webRequest need access to target AND initiator) and, for firewall or gpc,
// the optional declarativeNetRequestWithHostAccess.

import type { BackgroundChromeApi, PermissionsLike } from '../chrome-api';

export const PROTECT_BROAD_ORIGINS: readonly string[] = ['http://*/*', 'https://*/*'];
export const PROTECT_DNR_PERMISSION = 'declarativeNetRequestWithHostAccess';

export interface ProtectPermissions {
  broadHosts: boolean;
  dnr: boolean;
}

async function contains(api: BackgroundChromeApi, request: PermissionsLike): Promise<boolean> {
  try {
    return await api.permissions.contains(request);
  } catch {
    return false;
  }
}

/** Both checks; a failing query counts as "not granted" (fail-closed). */
export async function readProtectPermissions(api: BackgroundChromeApi): Promise<ProtectPermissions> {
  const [broadHosts, dnr] = await Promise.all([
    contains(api, { origins: [...PROTECT_BROAD_ORIGINS] }),
    contains(api, { permissions: [PROTECT_DNR_PERMISSION] }),
  ]);
  return { broadHosts, dnr };
}

/** permissions.onAdded / onRemoved payload concerns the module (broad host patterns, <all_urls> or the DNR permission). */
export function concernsProtect(change: PermissionsLike | undefined): boolean {
  if (change === undefined || change === null) return true;
  const origins = Array.isArray(change.origins) ? change.origins : [];
  const permissions = Array.isArray(change.permissions) ? change.permissions : [];
  if (permissions.includes(PROTECT_DNR_PERMISSION)) return true;
  return origins.some((o) => o === '<all_urls>' || PROTECT_BROAD_ORIGINS.includes(o) || o.startsWith('*://'));
}
