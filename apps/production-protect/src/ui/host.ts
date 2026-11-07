// ADR-047 (S1, port plan §2.5): host components of the module islands, built with the PRODUCTION page's Preact
// (h = its jsx-runtime factory, its hooks, its language state). The production page renders one empty container
// (`div.protect-island`, CSS display: contents) per surface and the module's own Preact (islands.tsx) renders into
// it; Preact never removes DOM nodes it did not create, so the island survives the host's re-renders (polling, a
// language change). The host passes its language on every render (useLocale makes it re-render on a change).
// Wiring into popup.js / sidepanel.js / options.js is step S3 (U1–U6); nothing loads this module before that.

import { moduleLocaleOf, setProductionLocale, t } from './i18n-shim';
import { PROTECT_OPTIONS_HASH, mountIsland } from './islands';
import type { IslandHandle, LauncherToolMaker, ProtectSurface } from './islands';

/** The production page's own Preact pieces (production names: u3, d2, h2, A2, useLocale, uiLocale, t3, LanguagePicker). */
export interface ProductionUiHost {
  /** jsx-runtime factory: (type, props with children, key?) => vnode. */
  h: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => unknown;
  useState: <S>(initial: S | (() => S)) => [S, (next: S) => void];
  useEffect: (effect: () => void | (() => void), deps?: ReadonlyArray<unknown>) => void;
  useRef: <T>(initial: T) => { current: T };
  /** Re-renders the component when the production language changes; returns the language id. */
  useLocale: () => string;
  uiLocale: () => string;
  /** Production translation (its 21-language tables). */
  translate: (key: string, substitutions?: ReadonlyArray<string>) => string;
  LanguagePicker: unknown;
}

export interface ProtectIslandProps {
  surface: ProtectSurface;
  tabId?: number | null;
  openSidePanel?: (() => void) | null;
  /** Launcher only (ADR-111): a maker of the control the Options shell draws between the title and the switch (see LauncherToolMaker). */
  toolSlot?: LauncherToolMaker | null;
}

export interface ProtectHostUi {
  ProtectIsland: (props: ProtectIslandProps) => unknown;
  ProtectPage: () => unknown;
  isProtectHash: (hash: string) => boolean;
}

/** Options hash routes of the module page (the vendored PROTECT_OPTIONS_HASHES). */
const PROTECT_HASHES: ReadonlySet<string> = new Set(['#protect', '#firewall', '#history', '#requests']);

export function isProtectHash(hash: string): boolean {
  return typeof hash === 'string' && PROTECT_HASHES.has(hash);
}

function optionsUrl(): string {
  try {
    return chrome.runtime.getURL('options.html');
  } catch {
    return 'options.html';
  }
}

export function createProtectHostUi(host: ProductionUiHost): ProtectHostUi {
  const { h, useEffect, useRef, useLocale } = host;

  function ProtectIsland(props: ProtectIslandProps): unknown {
    const locale = useLocale();
    const element = useRef<HTMLElement | null>(null);
    const handle = useRef<IslandHandle | null>(null);
    const tabId = typeof props.tabId === 'number' ? props.tabId : null;
    const openSidePanel = typeof props.openSidePanel === 'function' ? props.openSidePanel : null;
    const toolSlot = typeof props.toolSlot === 'function' ? props.toolSlot : null;
    useEffect(() => {
      const el = element.current;
      if (el === null) return undefined;
      try {
        handle.current = mountIsland(el, props.surface, { tabId, openSidePanel, locale, toolSlot });
      } catch {
        handle.current = null;
      }
      return () => {
        try {
          handle.current?.unmount();
        } catch {
          // Island already gone with its page.
        }
        handle.current = null;
      };
    }, [props.surface]);
    useEffect(() => {
      try {
        handle.current?.update({ tabId, openSidePanel, locale, toolSlot });
      } catch {
        // The island's own boundary reports module errors; the host never fails.
      }
    });
    return h('div', { class: 'protect-island', 'data-protect-island': props.surface, ref: element });
  }

  function ProtectPage(): unknown {
    const locale = useLocale();
    setProductionLocale(locale);
    useEffect(() => {
      try {
        document.title = t('protect_page_title') + ' — Detect.Expert';
      } catch {
        // No document title (static preview).
      }
    });
    return h('main', {
      class: 'app app--options blocking-page protect-page',
      children: [
        h('header', {
          class: 'header blocking-page-header',
          children: [
            h('a', { class: 'button blocking-page-back', href: optionsUrl(), children: host.translate('protection_back') }),
            h('h1', { class: 'app__title', lang: moduleLocaleOf(locale), dir: 'ltr', children: t('protect_page_title') }),
            h(host.LanguagePicker, {}),
          ],
        }),
        h(ProtectIsland, { surface: 'options-page' }),
      ],
    });
  }

  return { ProtectIsland, ProtectPage, isProtectHash };
}

export { PROTECT_OPTIONS_HASH };
