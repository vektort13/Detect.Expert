// webNavigation / tabs / permissions observers: map browser events to reducer events (spec A7, ADR-005).
// URLs are reduced to a sanitized host here and never stored (REQ-005). The listeners themselves are
// registered synchronously at the top level of the SW entry; these functions are the callbacks.
// ADR-020 (S04): commits of frame 0, closed and replaced tabs also reach the module «Защита» (an empty call while the
// module is off; the module reduces the URL to a site inside its tab model).

import { sanitizeHost } from '@detect-expert/contracts';
import type { NavigationDetailsLike, PermissionsLike } from './chrome-api';
import type { BackgroundRuntime } from './runtime';
import { readFrameType, readLifecycle } from './sender';

export interface NavigationObservers {
  onBeforeNavigate(details: NavigationDetailsLike): void;
  onCommitted(details: NavigationDetailsLike): void;
  onErrorOccurred(details: NavigationDetailsLike): void;
  onHistoryStateUpdated(details: NavigationDetailsLike): void;
  onReferenceFragmentUpdated(details: NavigationDetailsLike): void;
  onCompleted(details: NavigationDetailsLike): void;
  onTabRemoved(tabId: number): void;
  onTabReplaced(addedTabId: number, removedTabId: number): void;
  onPermissionsAdded(permissions: PermissionsLike): void;
  onPermissionsRemoved(permissions: PermissionsLike): void;
}

function ids(details: NavigationDetailsLike): { tabId: number; frameId: number } | null {
  if (typeof details.tabId !== 'number' || typeof details.frameId !== 'number' || details.tabId < 0 || details.frameId < 0) return null;
  return { tabId: details.tabId, frameId: details.frameId };
}

export function createNavigationObservers(runtime: BackgroundRuntime): NavigationObservers {
  const route = (details: NavigationDetailsLike): void => {
    const id = ids(details);
    if (id === null || typeof details.documentId !== 'string') return;
    runtime.dispatch({
      type: 'navigation:route',
      tabId: id.tabId,
      frameId: id.frameId,
      documentId: details.documentId,
      documentLifecycle: readLifecycle(details.documentLifecycle),
      at: runtime.now(),
    });
  };
  return {
    onBeforeNavigate(details) {
      const id = ids(details);
      if (id === null) return;
      runtime.dispatch({ type: 'navigation:before', tabId: id.tabId, frameId: id.frameId, host: sanitizeHost(details.url), at: runtime.now() });
    },
    onCommitted(details) {
      const id = ids(details);
      if (id === null || typeof details.documentId !== 'string') return;
      const host = sanitizeHost(details.url);
      const frameType = readFrameType(details.frameType);
      const documentLifecycle = readLifecycle(details.documentLifecycle);
      runtime.dispatch({
        type: 'navigation:committed',
        tabId: id.tabId,
        frameId: id.frameId,
        documentId: details.documentId,
        parentDocumentId: typeof details.parentDocumentId === 'string' ? details.parentDocumentId : null,
        frameType,
        documentLifecycle,
        host,
        ...(details.url.startsWith('https://') ? { scheme: 'https' as const } : details.url.startsWith('http://') ? { scheme: 'http' as const } : {}),
        at: runtime.now(),
      });
      runtime.protect.onCommitted(details);
    },
    onErrorOccurred(details) {
      const id = ids(details);
      if (id === null) return;
      runtime.dispatch({
        type: 'navigation:error',
        tabId: id.tabId,
        frameId: id.frameId,
        documentId: typeof details.documentId === 'string' ? details.documentId : null,
        at: runtime.now(),
      });
    },
    onHistoryStateUpdated: route,
    onReferenceFragmentUpdated: route,
    onCompleted(details) {
      const id = ids(details);
      if (id === null || typeof details.documentId !== 'string') return;
      runtime.dispatch({
        type: 'navigation:completed',
        tabId: id.tabId,
        frameId: id.frameId,
        documentId: details.documentId,
        documentLifecycle: readLifecycle(details.documentLifecycle),
        at: runtime.now(),
      });
    },
    onTabRemoved(tabId) {
      if (typeof tabId !== 'number') return;
      runtime.scope.noteTabRemoved(tabId);
      runtime.dispatch({ type: 'tab:removed', tabId, at: runtime.now() });
      runtime.protect.onTabRemoved(tabId);
    },
    onTabReplaced(addedTabId, removedTabId) {
      if (typeof addedTabId !== 'number' || typeof removedTabId !== 'number') return;
      runtime.scope.noteTabRemoved(removedTabId);
      runtime.dispatch({ type: 'tab:replaced', addedTabId, removedTabId, at: runtime.now() });
      runtime.protect.onTabReplaced(addedTabId, removedTabId);
    },
    onPermissionsAdded() {
      void runtime.onPermissionsChanged();
    },
    onPermissionsRemoved() {
      void runtime.onPermissionsChanged();
    },
  };
}
