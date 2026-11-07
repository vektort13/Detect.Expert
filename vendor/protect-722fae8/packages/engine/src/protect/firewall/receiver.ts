// ADR-020 §C (S08): which receivers the firewall may write a rule for. A receiver is a PSL registrable domain (never an
// IP literal, a local or single-label name), it is not the site itself (first party is never blocked) and it is not
// the parent of a public suffix (a shared platform: a rule there would block other people's sites).

import { isDomainName } from '@detect-expert/contracts';
import { isPslParentDomain, domainMatches } from '../../../../attribution/src/dnr-domains';
import { registrableDomain } from '../../../../attribution/src/index';

export type ReceiverCheck = 'ok' | 'no-domain' | 'first-party' | 'unsafe-receiver';

/**
 * `receiver` (ASCII lowercase) on top-level site `site` (null when unknown). Order: shape and registrability first,
 * then first party, then the public-suffix parent check.
 */
export function checkReceiver(receiver: unknown, site: string | null): ReceiverCheck {
  if (typeof receiver !== 'string' || !isDomainName(receiver)) return 'no-domain';
  if (registrableDomain(receiver) !== receiver) return 'no-domain';
  if (site !== null && (domainMatches(site, receiver) || domainMatches(receiver, site))) return 'first-party';
  if (isPslParentDomain(receiver)) return 'unsafe-receiver';
  return 'ok';
}

/** A preset entry's receiver host: a DNS name under a registrable domain (the domain itself or a host below it). */
export function isPresetReceiverHost(host: unknown): host is string {
  if (typeof host !== 'string' || !isDomainName(host)) return false;
  const site = registrableDomain(host);
  return site !== null && domainMatches(host, site) && !isPslParentDomain(host);
}
