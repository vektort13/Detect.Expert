// detect.expert — module «Защита» (ADR-020, ADR-047): Firefox stub of protect-ui.js (port plan §2.7). The module is
// Chrome-only; the production pages import these names in every build, so Firefox gets the same exports and renders
// nothing (no island, no Options route, no requests page, no firewall popup: firewall.html / firewall.js are not
// shipped). scripts/build-production.mjs copies this file over protect-ui.js in dist/firefox.
export const PROTECT_SURFACES = Object.freeze([]);
export function createProtectHostUi() {
  return Object.freeze({ ProtectIsland: () => null, ProtectPage: () => null, isProtectHash: () => false });
}
export function isProtectHash() {
  return false;
}
export function mountIsland() {
  return Object.freeze({ update() {}, unmount() {} });
}
export async function mountRequestsPage() {}
export async function mountFirewallPage() {}
export async function mountFindingsPage() {}
export async function mountActivationToastPage() {}
export function protectMessage(key, ...subs) {
  return subs.length === 0 ? { key } : { key, subs };
}
