// ADR-047 (S1, port plan §1.3, §2.5): UI bundle of the module «Защита» (protect-ui.js, ESM, its own Preact 10.29.8 —
// the same version as the production pages, no new dependency). Import order matters for `pnpm lint`: Preact first,
// then the vendored view-models/message.ts as the first application module, so the line
// `// packages/ui/src/view-models/message.ts` ends the inherited Preact prefix that scripts/production/
// lint-inventory.json pins by hash (build-protect.mjs checks the order). No dynamic import (CSP, code checks).
import 'preact';
import 'preact/hooks';
import 'preact/jsx-runtime';
// A used binding (not a bare import): the vendored ui package is side-effect free, so esbuild would skip a bare one.
export { msg as protectMessage } from '../../../vendor/protect-722fae8/packages/ui/src/view-models/message';
import { mountRequestsApp } from './ui/islands';
import { mountFirewallApp, readFirewallTab } from './ui/firewall-page';

export { createProtectHostUi, isProtectHash } from './ui/host';
export type { ProductionUiHost, ProtectHostUi, ProtectIslandProps } from './ui/host';
export { PROTECT_SURFACES, mountIsland } from './ui/islands';
export { mountFindingsPage } from './ui/findings-page';
export { mountActivationToastPage } from './ui/activation-toast-page';
export type { IslandHandle, LauncherToolKit, LauncherToolMaker, ProtectSurface } from './ui/islands';

const LANGUAGE_STORAGE_KEY = 'ui-language-v1';

/** Production language choice (storage.local 'ui-language-v1'), or null; bounded wait as the production pages. */
async function storedLanguage(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stored = await Promise.race([
      chrome.storage.local.get(LANGUAGE_STORAGE_KEY),
      new Promise<Record<string, unknown>>((resolve) => {
        timer = setTimeout(() => resolve({}), 500);
      }),
    ]);
    const value = stored[LANGUAGE_STORAGE_KEY];
    return typeof value === 'string' && /^[a-zA-Z_]{2,8}$/.test(value) ? value : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** requests.html (requests.js): the data-requests page in the production language (ru, else en). */
export async function mountRequestsPage(root: HTMLElement | null): Promise<void> {
  if (root === null) return;
  const language = await storedLanguage();
  mountRequestsApp(root, language);
  try {
    const lang = language === 'ru' || (language === null && /^ru\b/i.test(chrome.i18n.getUILanguage())) ? 'ru' : 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  } catch {
    // Static preview: the default lang of requests.html stays.
  }
}

/** The tab of firewall.html: ?tab=<id> set by the service worker, else the active tab of this window. */
async function firewallTab(): Promise<number | null> {
  const fromUrl = readFirewallTab(typeof location === 'undefined' ? '' : location.search);
  if (fromUrl !== null) return fromUrl;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab !== undefined && typeof tab.id === 'number' && tab.id >= 0 ? tab.id : null;
  } catch {
    return null;
  }
}

/** firewall.html (firewall.js, S4b): the firewall of the module as its own action popup, in the production language. */
export async function mountFirewallPage(root: HTMLElement | null): Promise<void> {
  if (root === null) return;
  const [language, tabId] = await Promise.all([storedLanguage(), firewallTab()]);
  let browser = '';
  try {
    browser = chrome.i18n.getUILanguage();
  } catch {
    browser = '';
  }
  const lang = language === 'ru' || (language === null && /^ru\b/i.test(browser)) ? 'ru' : 'en';
  mountFirewallApp(root, tabId, language ?? lang);
  try {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  } catch {
    // Static preview: the default lang of firewall.html stays.
  }
}
