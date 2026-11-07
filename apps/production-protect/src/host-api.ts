// ADR-047 (S1): contract between the production service worker (background.js) and the module «Защита»
// (protect-sw.js). background.js only assigns injection fields and calls these methods (port plan §2.1, B1–B8); the
// module never reads production state directly. Everything here is synchronous or fire-and-forget and never throws
// into the production runtime.

import type { PROTECT_UI_REQUEST_TYPES } from '@detect-expert/contracts';

/** Page message types of protect.js (ISOLATED -> SW), answered with protect-ack. */
export const PROTECT_PAGE_TYPES = Object.freeze(['protect-hello', 'protect-arm', 'protect-input', 'protect-events'] as const);
export type ProtectPageType = (typeof PROTECT_PAGE_TYPES)[number];
export type ProtectUiType = (typeof PROTECT_UI_REQUEST_TYPES)[number];

/** What background.js gives the module once (protectHost.attach), before background.start(). */
export interface ProtectHostBindings {
  /** Production ScopeController.isHostGrantedSync (grants, not the observation mode). */
  hostGranted(host: string, scheme: 'http' | 'https'): boolean;
  /** Production BadgeManager.mark(tabId): the per-tab badge is recomputed (it asks protectHost.badgeFor). */
  markBadge(tabId: number): void;
  /** Production BadgeManager.markAll(). */
  markAllBadges(): void;
}

/** Per-tab badge of firewall prompts: '1'…'9' / '9+' on the module colour, with a ru/en tooltip. */
export interface ProtectBadge {
  text: string;
  color: string;
  title: string;
}

/** Production FrameBinding fields the module reads (history top-site lookup). */
export interface ProductionBindingLike {
  tabId: number;
  frameId: number;
  documentId: string;
  documentKey: string;
  parentDocumentId: string | null;
  documentLifecycle: string | null;
  host: string | null;
}

export type ProductionBindingOf = (tabId: number, documentId: string) => unknown;

export interface ProtectHost {
  /** True for the exact message types of the module (page and UI); the production listener answers nothing then. */
  owns(message: unknown): boolean;
  /** Once, before background.start(): bindings, then the module loads its settings (off: two storage reads). */
  attach(bindings: ProtectHostBindings): void;
  /**
   * Firewall prompts waiting in the tab, or null (module off, snoozed, none waiting). S4b: the module's firewall popup
   * (firewall.html, surface.ts) follows the same count: it is scheduled from here, never awaited.
   */
  badgeFor(tabId: number, language: string): ProtectBadge | null;
  /** After a successful persist of an observation report (history source). Cheap shape check first. */
  reportPersisted(documentKey: string, report: unknown, meta: unknown, bindingOf: ProductionBindingOf): void;
  /** ui-clear-session of the production UI: the module's session documents go too. */
  clearSession(): void;
  /** detector-main-v1 was registered or updated: the module's MAIN registration goes after it again (W3). */
  observationMainRegistered(): void;
  /** storage.session keys of the module (subtracted from the production session budget). */
  sessionKeys(): string[];
}
