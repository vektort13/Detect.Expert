// detect.expert — module «Защита» (ADR-020, ADR-047): Firefox stub of protect-sw.js (port plan §2.7). The module is
// Chrome-only; background.js imports these names in every build, so Firefox gets the same exports without any
// behaviour: no listener, no storage, no registration, no DNR call. scripts/build-production.mjs copies this file over
// protect-sw.js in dist/firefox and does not ship the other module files.
export const PROTECT_BADGE_SETTLE_MS = 1000;
export function ownsProtectMessage() {
  return false;
}
export function isProtectSessionKey() {
  return false;
}
export const protectHost = Object.freeze({
  owns: () => false,
  attach() {},
  badgeFor: () => null,
  reportPersisted() {},
  clearSession() {},
  observationMainRegistered() {},
  sessionKeys: () => [],
});
